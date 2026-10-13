/**
 * Card inbox: the one place where review items produced by the rest of the ecosystem enter Vega
 * (Polaris error log and self-checks, Orion repeated failures, Mira missed prediction stops, Rigel questions
 * grounded in lesson files, ...).
 * Contract: vega-card-inbox.v1 (amendment 2026-10-13: producer "rigel", origin kind "rigel-ref"; nothing else changed).
 *
 *   <hub>/.vega/inbox/<producer>-<YYYYMMDDTHHmmss>-<6 hex>.jsonl   one JSON object per line
 *   <hub>/.vega/inbox/done/                                         processed files
 *   <hub>/.vega/inbox/rejected/<same name>                          invalid lines + "_error"
 *
 * Vega alone validates, de-duplicates (by `key`, against active, suspended and soft-deleted cards) and
 * schedules the cards with FSRS; producers never touch cards.json or reviews.jsonl. Ingestion is idempotent.
 */
import { existsSync, type Dirent } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { TextDecoder } from "node:util";
import { initFsrsState } from "./fsrs.js";
import {
  CARD_KEY_MAX,
  INBOX_CARD_KINDS,
  INBOX_ORIGIN_KINDS,
  INBOX_PRODUCERS,
  ORIGIN_HREF_MAX,
  isSafeHref,
  type Card,
  type InboxCardKind,
  type InboxCreatedCard,
  type InboxFileError,
  type InboxFileReport,
  type InboxIngestResult,
  type InboxLine,
  type InboxListResult,
  type InboxOriginKind,
  type InboxProducer,
  type VegaCollection,
} from "./schema.js";
import { loadCollection, readDeletedKeys, saveCollection } from "./store.js";
import { atomicWriteFile, errMsg, generateCardId, readJson, vegaPaths } from "./util.js";

/* ───────── Line validation ───────── */

const LINE_FIELDS: readonly string[] = [
  "v",
  "t",
  "producer",
  "key",
  "subject",
  "deck",
  "kind",
  "front",
  "back",
  "hint",
  "hook",
  "origin",
  "tags",
  "reason",
];
const ORIGIN_FIELDS: readonly string[] = ["kind", "path", "locator", "href"];

const ISO_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/;
const EMOJI_RE = /\p{Emoji_Presentation}|\uFE0F/u;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** Maximum number of per-file problems kept in a report (rejected lines are always all written to rejected/). */
const MAX_PROBLEMS_PER_FILE = 50;
/** How many problems per file the Vietnamese summary spells out. */
const SUMMARY_PROBLEMS_PER_FILE = 5;
/** How many created cards the Vietnamese summary lists. */
const SUMMARY_CREATED_CARDS = 20;

export type InboxValidation = { ok: true; line: InboxLine } | { ok: false; errors: string[] };

/** Length in Unicode code points (what "chars" means in the contract; equals .length for NFC Vietnamese). */
function charLength(value: string): number {
  return Array.from(value).length;
}

/** Field names as `"a", "b"`, bounded so a hostile line cannot blow up a report. */
function quoted(names: readonly string[]): string {
  const shown = names.slice(0, 8).map((n) => `"${n.length > 40 ? `${n.slice(0, 37)}...` : n}"`);
  return names.length > 8 ? `${shown.join(", ")}, ... (+${names.length - 8})` : shown.join(", ");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a string field with a code-point length range. Values are trimmed first, so a whitespace-only value
 * counts as empty. Returns the trimmed string, or undefined when absent or invalid (an error is recorded).
 */
function readString(
  errors: string[],
  container: Record<string, unknown>,
  field: string,
  label: string,
  opts: { required: boolean; min: number; max: number },
): string | undefined {
  const value = container[field];
  if (value === undefined) {
    if (opts.required) errors.push(`thiếu trường bắt buộc "${label}"`);
    return undefined;
  }
  if (typeof value !== "string") {
    errors.push(`"${label}" phải là chuỗi`);
    return undefined;
  }
  const trimmed = value.trim();
  const length = charLength(trimmed);
  if (length < opts.min) {
    errors.push(
      opts.min === 1 ? `"${label}" không được rỗng` : `"${label}" quá ngắn (${length} ký tự, tối thiểu ${opts.min})`,
    );
    return undefined;
  }
  if (length > opts.max) {
    errors.push(`"${label}" quá dài (${length} ký tự, tối đa ${opts.max})`);
    return undefined;
  }
  return trimmed;
}

/** ISO 8601 date-time with seconds and an explicit offset (Z or +hh:mm), checked against the real calendar. */
export function isIsoDateTimeWithOffset(value: string): boolean {
  const m = ISO_DATE_TIME_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  if (month < 1 || month > 12) return false;
  const lastDay = new Date(0);
  lastDay.setUTCFullYear(year, month, 0);
  if (day < 1 || day > lastDay.getUTCDate()) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (m[7] !== "Z" && (Number(m[8]) > 23 || Number(m[9]) > 59)) return false;
  return !Number.isNaN(Date.parse(value));
}

/**
 * Strict validation of one inbox line against vega-card-inbox.v1: unknown fields are rejected, every rule of the
 * contract table is checked and all problems of the line are reported (Vietnamese texts).
 */
export function validateInboxLine(raw: unknown): InboxValidation {
  if (!isPlainObject(raw)) {
    return { ok: false, errors: ["dòng phải là một đối tượng JSON"] };
  }
  const obj = raw;
  const errors: string[] = [];

  const unknownFields = Object.keys(obj).filter((k) => !LINE_FIELDS.includes(k));
  if (unknownFields.length > 0) {
    errors.push(`trường lạ không được phép: ${quoted(unknownFields)}`);
  }

  // v
  if (obj.v === undefined) errors.push('thiếu trường bắt buộc "v"');
  else if (obj.v !== 1) errors.push('"v" phải là số nguyên 1');

  // t
  const t = readString(errors, obj, "t", "t", { required: true, min: 1, max: 64 });
  if (t !== undefined && !isIsoDateTimeWithOffset(t)) {
    errors.push('"t" phải là thời điểm ISO 8601 có múi giờ (Z hoặc +hh:mm), ví dụ 2026-10-12T10:30:00+07:00');
  }

  // producer
  let producer: InboxProducer | undefined;
  if (obj.producer === undefined) {
    errors.push('thiếu trường bắt buộc "producer"');
  } else if (typeof obj.producer !== "string" || !(INBOX_PRODUCERS as readonly string[]).includes(obj.producer)) {
    errors.push(`"producer" phải là một trong: ${INBOX_PRODUCERS.join(", ")}`);
  } else {
    producer = obj.producer as InboxProducer;
  }

  // key (stable dedupe key, must start with "<producer>:")
  const key = readString(errors, obj, "key", "key", { required: true, min: 1, max: CARD_KEY_MAX });
  if (key !== undefined) {
    if (CONTROL_RE.test(key)) {
      errors.push('"key" không được chứa ký tự điều khiển (xuống dòng, tab...)');
    } else if (producer !== undefined && !(key.startsWith(`${producer}:`) && key.length > producer.length + 1)) {
      errors.push(`"key" phải bắt đầu bằng "${producer}:" và có nội dung phía sau`);
    }
  }

  const subject = readString(errors, obj, "subject", "subject", { required: true, min: 1, max: 120 });
  const deck = readString(errors, obj, "deck", "deck", { required: false, min: 0, max: 120 });

  // kind
  let kind: InboxCardKind = "basic";
  if (obj.kind !== undefined) {
    if (typeof obj.kind !== "string" || !(INBOX_CARD_KINDS as readonly string[]).includes(obj.kind)) {
      errors.push(`"kind" phải là một trong: ${INBOX_CARD_KINDS.join(", ")}`);
    } else {
      kind = obj.kind as InboxCardKind;
    }
  }

  const front = readString(errors, obj, "front", "front", { required: true, min: 1, max: 600 });
  if (front !== undefined && EMOJI_RE.test(front)) {
    errors.push('"front" không được chứa emoji');
  }
  const back = readString(errors, obj, "back", "back", { required: true, min: 0, max: 1200 });
  const hint = readString(errors, obj, "hint", "hint", { required: false, min: 0, max: 200 });
  const hook = readString(errors, obj, "hook", "hook", { required: false, min: 0, max: 200 });
  const reason = readString(errors, obj, "reason", "reason", { required: false, min: 0, max: 200 });

  // origin
  let origin: InboxLine["origin"] | undefined;
  if (obj.origin === undefined) {
    errors.push('thiếu trường bắt buộc "origin"');
  } else if (!isPlainObject(obj.origin)) {
    errors.push('"origin" phải là một đối tượng');
  } else {
    const o = obj.origin;
    const unknownOrigin = Object.keys(o).filter((k) => !ORIGIN_FIELDS.includes(k));
    if (unknownOrigin.length > 0) {
      errors.push(`trường lạ không được phép trong "origin": ${quoted(unknownOrigin)}`);
    }
    let originKind: InboxOriginKind | undefined;
    if (o.kind === undefined) {
      errors.push('thiếu trường bắt buộc "origin.kind"');
    } else if (typeof o.kind !== "string" || !(INBOX_ORIGIN_KINDS as readonly string[]).includes(o.kind)) {
      errors.push(`"origin.kind" phải là một trong: ${INBOX_ORIGIN_KINDS.join(", ")}`);
    } else {
      originKind = o.kind as InboxOriginKind;
    }
    const path = readString(errors, o, "path", "origin.path", { required: true, min: 1, max: 400 });
    const locator = readString(errors, o, "locator", "origin.locator", { required: false, min: 0, max: 120 });
    const href = readString(errors, o, "href", "origin.href", { required: false, min: 0, max: ORIGIN_HREF_MAX });
    if (href && !isSafeHref(href)) {
      errors.push('"origin.href" không được dùng giao thức javascript:, data: hoặc vbscript:');
    }
    if (originKind !== undefined && path !== undefined) {
      origin = {
        kind: originKind,
        path,
        ...(locator ? { locator } : {}),
        ...(href ? { href } : {}),
      };
    }
  }

  // tags
  const tags: string[] = [];
  if (obj.tags !== undefined) {
    if (!Array.isArray(obj.tags)) {
      errors.push('"tags" phải là mảng chuỗi');
    } else {
      if (obj.tags.length > 10) {
        errors.push(`"tags" có ${obj.tags.length} phần tử, tối đa 10`);
      }
      obj.tags.forEach((tag: unknown, index: number) => {
        if (typeof tag !== "string") {
          errors.push(`"tags[${index}]" phải là chuỗi`);
          return;
        }
        const trimmed = tag.trim();
        const length = charLength(trimmed);
        if (length < 1 || length > 40) {
          errors.push(`"tags[${index}]" phải dài 1-40 ký tự`);
          return;
        }
        tags.push(trimmed);
      });
    }
  }

  if (
    errors.length > 0 ||
    t === undefined ||
    producer === undefined ||
    key === undefined ||
    subject === undefined ||
    front === undefined ||
    back === undefined ||
    origin === undefined
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    line: {
      v: 1,
      t,
      producer,
      key,
      subject,
      ...(deck ? { deck } : {}),
      kind,
      front,
      back,
      ...(hint ? { hint } : {}),
      ...(hook ? { hook } : {}),
      origin,
      tags,
      ...(reason ? { reason } : {}),
    },
  };
}

/** Build the New FSRS card for a valid line: created = line t, key and origin (with href) kept. */
export function buildCardFromInboxLine(line: InboxLine): Card {
  const created = new Date(line.t);
  return {
    id: generateCardId("c"),
    subject: line.subject,
    ...(line.deck ? { deck: line.deck } : {}),
    kind: line.kind,
    front: line.front,
    back: line.back,
    ...(line.hint ? { hint: line.hint } : {}),
    ...(line.hook ? { hook: line.hook } : {}),
    origin: {
      kind: line.origin.kind,
      path: line.origin.path,
      ...(line.origin.locator ? { locator: line.origin.locator } : {}),
      ...(line.origin.href ? { href: line.origin.href } : {}),
    },
    tags: line.tags,
    created: created.toISOString(),
    key: line.key,
    fsrs: initFsrsState(created),
  };
}

/* ───────── Reading the inbox ───────── */

interface ParsedEntryOk {
  line: number;
  ok: true;
  value: InboxLine;
}

interface ParsedEntryBad {
  line: number;
  ok: false;
  error: string;
  /** The original object (or { _raw } when the line is not a JSON object) that goes to rejected/. */
  record: Record<string, unknown>;
}

type ParsedEntry = ParsedEntryOk | ParsedEntryBad;

interface ParsedInboxFile {
  name: string;
  path: string;
  /** Non-blank lines. */
  lines: number;
  entries: ParsedEntry[];
}

interface InboxAnalysis {
  inboxDir: string;
  exists: boolean;
  collection: VegaCollection | null;
  files: Array<{ parsed: ParsedInboxFile; report: InboxFileReport }>;
  newCards: Array<{ card: Card; reason?: string }>;
  ignored: string[];
  fileErrors: InboxFileError[];
}

function isHiddenOrSystemName(name: string): boolean {
  const lower = name.toLowerCase();
  return name.startsWith(".") || lower === "thumbs.db" || lower === "desktop.ini";
}

function isInboxFileName(name: string): boolean {
  return name.toLowerCase().endsWith(".jsonl");
}

function readErrorText(e: unknown): string {
  if (e instanceof TypeError && /not valid for encoding|encoded data/i.test(e.message)) {
    return "tệp không phải UTF-8 hợp lệ";
  }
  return errMsg(e);
}

async function parseInboxFile(path: string, name: string): Promise<ParsedInboxFile> {
  const buffer = await readFile(path);
  // fatal: a mis-encoded file must not silently turn Vietnamese text into U+FFFD cards. A leading BOM is dropped.
  const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  const entries: ParsedEntry[] = [];
  let lines = 0;

  text.split("\n").forEach((rawLine, index) => {
    const line = rawLine.replace(/\r$/, "");
    if (line.trim() === "") return;
    lines++;
    const lineNo = index + 1;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      entries.push({
        line: lineNo,
        ok: false,
        error: `JSON không hợp lệ: ${errMsg(e).slice(0, 120)}`,
        record: { _raw: line },
      });
      return;
    }

    const validation = validateInboxLine(parsed);
    if (validation.ok) {
      entries.push({ line: lineNo, ok: true, value: validation.line });
    } else {
      entries.push({
        line: lineNo,
        ok: false,
        error: validation.errors.join("; "),
        record: isPlainObject(parsed) ? parsed : { _raw: parsed },
      });
    }
  });

  return { name, path, lines, entries };
}

/**
 * Read-only analysis shared by `list` and `ingest`: finds the pending files (name order), parses and validates
 * every line, and classifies it against the known keys (active, suspended and soft-deleted cards, plus earlier
 * lines of this batch). Nothing is written.
 */
async function analyzeInbox(hub?: string): Promise<InboxAnalysis> {
  const p = vegaPaths(hub);
  const analysis: InboxAnalysis = {
    inboxDir: p.inboxDir,
    exists: existsSync(p.inboxDir),
    collection: null,
    files: [],
    newCards: [],
    ignored: [],
    fileErrors: [],
  };
  if (!analysis.exists) return analysis;

  let dirents: Dirent[];
  try {
    dirents = await readdir(p.inboxDir, { withFileTypes: true });
  } catch (e) {
    analysis.fileErrors.push({ file: ".", error: `không đọc được thư mục hộp thư: ${errMsg(e)}` });
    return analysis;
  }

  // Subfolders (done/, rejected/) and hidden or system files are not inbox files; *.tmp files are producers
  // still writing, so they are ignored and reported.
  const names: string[] = [];
  for (const dirent of dirents) {
    if (!dirent.isFile() || isHiddenOrSystemName(dirent.name)) continue;
    if (isInboxFileName(dirent.name)) names.push(dirent.name);
    else analysis.ignored.push(dirent.name);
  }
  names.sort();
  analysis.ignored.sort();

  const parsedFiles: ParsedInboxFile[] = [];
  for (const name of names) {
    try {
      parsedFiles.push(await parseInboxFile(join(p.inboxDir, name), name));
    } catch (e) {
      analysis.fileErrors.push({ file: name, error: readErrorText(e) });
    }
  }
  if (parsedFiles.length === 0) return analysis;

  // loadCollection() treats an unparseable cards.json as an empty collection; saving after that would overwrite
  // the learner's cards. Refuse instead, before anything is changed.
  if (existsSync(p.cardsJson) && (await readJson<unknown>(p.cardsJson)) === null) {
    throw new Error(
      `cards.json không phân tích được (JSON hỏng), dừng xử lý hộp thư để không ghi đè bộ thẻ: ${p.cardsJson}`,
    );
  }

  // Keep the load -> classify -> save window short: everything above is file reading only.
  const deletedKeys = await readDeletedKeys(hub);
  const collection = await loadCollection(hub);
  analysis.collection = collection;

  const knownKeys = new Set<string>(deletedKeys);
  for (const card of collection.cards) {
    if (card.key) knownKeys.add(card.key);
  }

  for (const parsed of parsedFiles) {
    const report: InboxFileReport = {
      file: parsed.name,
      lines: parsed.lines,
      created: 0,
      duplicates: 0,
      rejected: 0,
      problems: [],
    };
    for (const entry of parsed.entries) {
      if (!entry.ok) {
        report.rejected++;
        if (report.problems.length < MAX_PROBLEMS_PER_FILE) {
          report.problems.push({ line: entry.line, error: entry.error });
        }
        continue;
      }
      if (knownKeys.has(entry.value.key)) {
        report.duplicates++;
        continue;
      }
      knownKeys.add(entry.value.key);
      analysis.newCards.push({ card: buildCardFromInboxLine(entry.value), reason: entry.value.reason });
      report.created++;
    }
    analysis.files.push({ parsed, report });
  }

  return analysis;
}

/* ───────── Reports (Vietnamese) ───────── */

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}

/** Compact "files / created / duplicates / rejected" counts used by vega_sync. */
export function inboxCountsText(r: Pick<InboxIngestResult, "files_read" | "cards_created" | "duplicates_skipped" | "lines_rejected">): string {
  return `đọc ${r.files_read} tệp · tạo ${r.cards_created} thẻ · trùng ${r.duplicates_skipped} · từ chối ${r.lines_rejected}`;
}

function problemLines(report: InboxFileReport, indent: string): string[] {
  const out = report.problems
    .slice(0, SUMMARY_PROBLEMS_PER_FILE)
    .map((p) => `${indent}dòng ${p.line}: ${p.error}`);
  const hidden = report.rejected - Math.min(report.problems.length, SUMMARY_PROBLEMS_PER_FILE);
  if (hidden > 0) out.push(`${indent}... và ${hidden} dòng lỗi khác`);
  return out;
}

function sideNotes(ignored: string[], fileErrors: InboxFileError[]): string[] {
  const out: string[] = [];
  if (ignored.length > 0) {
    const shown = ignored.slice(0, 10).join(", ");
    out.push(
      `- Bỏ qua ${ignored.length} tệp không phải .jsonl (đang ghi dở hoặc không thuộc hộp thư): ${shown}${ignored.length > 10 ? ", ..." : ""}`,
    );
  }
  for (const err of fileErrors) {
    out.push(
      err.file === "."
        ? `- Lỗi hộp thư: ${err.error}`
        : `- Lỗi với tệp ${err.file}: ${err.error} (tệp được giữ nguyên trong hộp thư)`,
    );
  }
  return out;
}

function renderListSummary(r: InboxListResult): string {
  const lines: string[] = [`Hộp thư thẻ Vega (chỉ đọc, không ghi gì): ${r.inbox_dir}`];
  if (!r.exists) {
    lines.push("- Thư mục hộp thư chưa tồn tại: chưa có nhà sản xuất nào gửi thẻ.");
  } else if (r.pending_files === 0) {
    lines.push("- Không có tệp .jsonl nào đang chờ.");
  } else {
    lines.push(`- Tệp đang chờ: ${r.pending_files} (${r.lines_total} dòng)`);
    lines.push(
      `- Nếu nạp bây giờ: tạo ${r.would_create} thẻ mới · bỏ qua ${r.would_skip_duplicates} dòng trùng khóa · từ chối ${r.would_reject} dòng`,
    );
  }
  lines.push(...sideNotes(r.ignored_files, r.file_errors));

  if (r.files.length > 0) {
    lines.push("", "Từng tệp:");
    for (const f of r.files) {
      lines.push(
        `- ${f.file}: ${f.lines} dòng · sẽ tạo ${f.created} · trùng ${f.duplicates} · sẽ từ chối ${f.rejected}`,
      );
      lines.push(...problemLines(f, "    "));
    }
    lines.push("", 'Nạp bằng vega_inbox { action: "ingest" } hoặc vega_sync.');
  }
  return lines.join("\n");
}

function renderIngestSummary(r: InboxIngestResult): string {
  const lines: string[] = [`Hộp thư thẻ Vega: ${r.inbox_dir}`];
  if (r.files_read === 0) {
    lines.push("- Hộp thư trống: không có tệp .jsonl nào đang chờ.");
  } else {
    lines.push(`- Tệp đã đọc: ${r.files_read} (${r.lines_total} dòng)`);
    lines.push(`- Thẻ mới tạo: ${r.cards_created}`);
    lines.push(`- Trùng khóa (bỏ qua): ${r.duplicates_skipped}`);
    lines.push(`- Dòng bị từ chối: ${r.lines_rejected}`);
  }
  lines.push(...sideNotes(r.ignored_files, r.file_errors));

  if (r.files.length > 0) {
    lines.push("", "Từng tệp:");
    for (const f of r.files) {
      const where = f.moved_to ? ` -> ${f.moved_to}` : " (chưa chuyển được tệp)";
      const rejectedNote = f.rejected_to ? `; dòng lỗi: ${f.rejected_to}` : "";
      lines.push(
        `- ${f.file}: ${f.lines} dòng · tạo ${f.created} · trùng ${f.duplicates} · từ chối ${f.rejected}${where}${rejectedNote}`,
      );
      lines.push(...problemLines(f, "    "));
    }
  }

  if (r.created_cards.length > 0) {
    lines.push("", "Thẻ mới (trạng thái New, vào hàng đợi theo giới hạn thẻ mới mỗi ngày):");
    for (const c of r.created_cards.slice(0, SUMMARY_CREATED_CARDS)) {
      lines.push(
        `  - [${c.id}] ${c.key} · ${oneLine(c.front, 70)}${c.reason ? ` (lý do: ${oneLine(c.reason, 80)})` : ""}`,
      );
    }
    if (r.created_cards.length > SUMMARY_CREATED_CARDS) {
      lines.push(`  ... và ${r.created_cards.length - SUMMARY_CREATED_CARDS} thẻ khác`);
    }
  }
  return lines.join("\n");
}

/** An ingest result with nothing read (used when the ingestion itself failed). */
export function emptyIngestResult(hub?: string): InboxIngestResult {
  const result: InboxIngestResult = {
    inbox_dir: vegaPaths(hub).inboxDir,
    files_read: 0,
    lines_total: 0,
    cards_created: 0,
    duplicates_skipped: 0,
    lines_rejected: 0,
    files: [],
    created_cards: [],
    ignored_files: [],
    file_errors: [],
    summary: "",
  };
  result.summary = renderIngestSummary(result);
  return result;
}

/**
 * The inbox block of the vega_sync summary: the counts, plus (compactly) why lines were rejected, so the
 * learner sees a problem without calling vega_inbox.
 */
export function inboxSyncLines(r: InboxIngestResult, error?: string): string[] {
  if (error) {
    return [`- Hộp thư thẻ: lỗi, bỏ qua bước nạp (${error})`];
  }
  const lines = [`- Hộp thư thẻ: ${inboxCountsText(r)}`];
  const shown: string[] = [];
  let hidden = 0;
  for (const f of r.files) {
    for (const p of f.problems) {
      if (shown.length < SUMMARY_PROBLEMS_PER_FILE) shown.push(`    ${f.file} dòng ${p.line}: ${p.error}`);
      else hidden++;
    }
  }
  if (shown.length > 0) {
    lines.push("  Dòng bị từ chối (đã ghi vào inbox/rejected/):", ...shown);
    if (hidden > 0) lines.push(`    ... và ${hidden} dòng lỗi khác`);
  }
  for (const err of r.file_errors) {
    lines.push(`  Lỗi với tệp ${err.file}: ${err.error}`);
  }
  return lines;
}

/* ───────── Public API ───────── */

/** Preview of the pending files and their validation. Reads only: no file or folder is created or changed. */
export async function listInbox(hub?: string): Promise<InboxListResult> {
  const a = await analyzeInbox(hub);
  const reports = a.files.map((f) => f.report);
  const result: InboxListResult = {
    inbox_dir: a.inboxDir,
    exists: a.exists,
    pending_files: reports.length,
    lines_total: reports.reduce((n, r) => n + r.lines, 0),
    would_create: reports.reduce((n, r) => n + r.created, 0),
    would_skip_duplicates: reports.reduce((n, r) => n + r.duplicates, 0),
    would_reject: reports.reduce((n, r) => n + r.rejected, 0),
    files: reports,
    ignored_files: a.ignored,
    file_errors: a.fileErrors,
    summary: "",
  };
  result.summary = renderListSummary(result);
  return result;
}

interface Destination {
  path: string;
  /** An identical file is already there, so nothing needs to be written or moved. */
  same: boolean;
}

/**
 * Pick the file to write inside done/ or rejected/. Producers never reuse a name, but if one does the earlier
 * file must survive: identical content is a no-op (idempotent crash recovery), different content gets ".2", ".3"...
 */
async function resolveDestination(
  dir: string,
  name: string,
  sameContent: (existingPath: string) => Promise<boolean>,
): Promise<Destination> {
  await mkdir(dir, { recursive: true });
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let candidate = join(dir, name);
  let n = 1;
  while (existsSync(candidate)) {
    if (await sameContent(candidate)) return { path: candidate, same: true };
    n++;
    candidate = join(dir, `${stem}.${n}${ext}`);
  }
  return { path: candidate, same: false };
}

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch {
    await copyFile(from, to);
    await unlink(from);
  }
}

/** Phase C of ingest: write the rejected lines (atomic), then move the processed file to done/. */
async function archiveFile(
  entry: { parsed: ParsedInboxFile; report: InboxFileReport },
  paths: ReturnType<typeof vegaPaths>,
): Promise<void> {
  const { parsed, report } = entry;

  if (report.rejected > 0) {
    const content =
      parsed.entries
        .filter((e): e is ParsedEntryBad => !e.ok)
        .map((e) => JSON.stringify({ ...e.record, _error: `dòng ${e.line}: ${e.error}` }))
        .join("\n") + "\n";
    const dest = await resolveDestination(paths.inboxRejectedDir, parsed.name, async (existing) => {
      return (await readFile(existing, "utf8")) === content;
    });
    if (!dest.same) await atomicWriteFile(dest.path, content);
    report.rejected_to = `rejected/${basename(dest.path)}`;
  }

  const done = await resolveDestination(paths.inboxDoneDir, parsed.name, async (existing) => {
    const [a, b] = await Promise.all([readFile(existing), readFile(parsed.path)]);
    return a.equals(b);
  });
  if (done.same) await unlink(parsed.path);
  else await moveFile(parsed.path, done.path);
  report.moved_to = `done/${basename(done.path)}`;
}

let ingestQueue: Promise<unknown> = Promise.resolve();

/**
 * Ingest the inbox: validate every line, skip keys that already exist (active, suspended or soft-deleted),
 * create New FSRS cards, save cards.json once (atomic), then move each processed file to done/ and write its
 * invalid lines (with "_error") to rejected/<same name>. Files are touched only after the cards are saved,
 * so a crash can never lose cards, and a second run is a no-op (idempotent through keys).
 *
 * One ingest runs at a time per process: two parallel tool calls (for example vega_sync and vega_inbox) must not
 * read the same files and race to archive them.
 */
export function ingestInbox(hub?: string): Promise<InboxIngestResult> {
  const run = ingestQueue.then(
    () => ingestInboxNow(hub),
    () => ingestInboxNow(hub),
  );
  ingestQueue = run.catch(() => undefined);
  return run;
}

async function ingestInboxNow(hub?: string): Promise<InboxIngestResult> {
  const paths = vegaPaths(hub);
  const a = await analyzeInbox(hub);

  if (a.newCards.length > 0 && a.collection) {
    for (const { card } of a.newCards) a.collection.cards.push(card);
    await saveCollection(a.collection, hub);
  }

  const fileErrors = [...a.fileErrors];
  for (const entry of a.files) {
    try {
      await archiveFile(entry, paths);
    } catch (e) {
      fileErrors.push({ file: entry.parsed.name, error: `không chuyển được tệp: ${errMsg(e)}` });
    }
  }

  const reports = a.files.map((f) => f.report);
  const created: InboxCreatedCard[] = a.newCards.map(({ card, reason }) => ({
    id: card.id,
    key: card.key ?? "",
    subject: card.subject,
    front: card.front,
    ...(reason ? { reason } : {}),
  }));

  const result: InboxIngestResult = {
    inbox_dir: a.inboxDir,
    files_read: reports.length,
    lines_total: reports.reduce((n, r) => n + r.lines, 0),
    cards_created: created.length,
    duplicates_skipped: reports.reduce((n, r) => n + r.duplicates, 0),
    lines_rejected: reports.reduce((n, r) => n + r.rejected, 0),
    files: reports,
    created_cards: created,
    ignored_files: a.ignored,
    file_errors: fileErrors,
    summary: "",
  };
  result.summary = renderIngestSummary(result);
  return result;
}
