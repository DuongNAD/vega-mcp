import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { getDueQueue } from "./scheduler.js";
import {
  type Card,
  type OriginKind,
  type SessionOptions,
  type SessionResult,
  type SrsSlide,
  type SrsSlideOrigin,
} from "./schema.js";
import { errMsg, vegaPaths, writeJson } from "./util.js";

/** Short Vietnamese name of each origin kind, used as the first part of the origin label on a session slide. */
export const ORIGIN_KIND_LABELS: Record<OriginKind, string> = {
  "polaris-fact": "Dữ kiện",
  "polaris-errorlog": "Sổ lỗi",
  "polaris-selfcheck": "Tự kiểm tra",
  "aurora-notebook": "Sổ tay",
  "aurora-quiz": "Trắc nghiệm",
  "aurora-flashcard": "Thẻ ghi nhớ",
  "aurora-palace": "Cung điện trí nhớ",
  "aurora-predict": "Dự đoán",
  "orion-attempt": "Orion",
  "mira-stop": "Mira",
  "rigel-ref": "Tài liệu",
  manual: "Thủ công",
};

const ORIGIN_LABEL_MAX = 80;

/** "stop-3", "#stop-3" or "điểm dừng 3" -> "điểm dừng 3"; any other text is kept as it is. */
function miraStopDetail(text: string): string {
  const normalized = text.normalize("NFC").trim();
  if (/điểm\s*dừng/i.test(normalized)) return normalized;
  const m = normalized.match(/(?:^|[^a-z0-9])stop[\s_-]*(\d+)/i);
  return m ? `điểm dừng ${m[1]}` : normalized;
}

/**
 * Short Vietnamese description of where a card comes from: "<kind name> · <detail>", for example
 * "Mira · điểm dừng 3", "Sổ lỗi · ERR_2026-10-12_ab12cd", "Orion · <check>" or "Tài liệu · D3#12 · slide 7" (rigel-ref).
 * The detail is the origin locator, falling back to the tail of the card key (<producer>:<scope>:<detail>), then to
 * the deck. A rigel-ref card has no key tail fallback (its key tail ends with a hash), only locator, then deck.
 */
export function describeOrigin(card: Pick<Card, "origin" | "deck" | "key">): string {
  const kind = card.origin.kind;
  const prefix = ORIGIN_KIND_LABELS[kind] ?? kind;
  const locator = card.origin.locator?.normalize("NFC").trim() ?? "";
  const keyTail = (card.key?.split(":").slice(2).join(":") ?? "").trim();

  let detail: string;
  switch (kind) {
    case "mira-stop":
      detail = miraStopDetail(locator || keyTail) || card.deck || "";
      break;
    case "polaris-selfcheck": {
      const m = card.key?.match(/:selfcheck:(.+):(\d+)$/);
      detail = locator || (m ? `${m[1]} · mục ${m[2]}` : "") || card.deck || "";
      break;
    }
    case "polaris-errorlog":
    case "orion-attempt":
      detail = locator || keyTail || card.deck || "";
      break;
    default:
      detail = locator || card.deck || "";
  }

  const label = detail ? `${prefix} · ${detail}` : prefix;
  return label.length > ORIGIN_LABEL_MAX ? `${label.slice(0, ORIGIN_LABEL_MAX - 3)}...` : label;
}

export function findAuroraCli(): string | null {
  const envCli = process.env.VEGA_AURORA_CLI;
  if (envCli && existsSync(envCli)) {
    return envCli;
  }
  const defaultCli = "D:/03_Development_Projects/Slide_Projects/my_projects/aurora_slides_mcp/dist/aurora.mjs";
  if (existsSync(defaultCli)) {
    return defaultCli;
  }
  return null;
}

export async function createSessionDeck(options: SessionOptions = {}): Promise<SessionResult> {
  const dueRes = await getDueQueue({
    date: options.date,
    limit: options.limit,
    new_limit: options.new_limit,
    subject: options.subject,
    hub: options.hub,
  });

  const p = vegaPaths(options.hub);
  const sessionDir = p.sessionDir;
  const deckJsonPath = p.sessionDeckJson;

  await mkdir(sessionDir, { recursive: true });

  // 1. Group counts by subject
  const subjectCounts: Record<string, number> = {};
  for (const card of dueRes.queue) {
    const s = card.subject || "Chung";
    subjectCounts[s] = (subjectCounts[s] ?? 0) + 1;
  }
  const subjectBreakdown = Object.entries(subjectCounts)
    .map(([s, count]) => `${s} (${count})`)
    .join(", ");

  const subtitle =
    dueRes.queue.length > 0
      ? `${dueRes.queue.length} thẻ cần ôn tập${subjectBreakdown ? ` · ${subjectBreakdown}` : ""}`
      : "Không có thẻ nào cần ôn tập hôm nay.";

  // 2. Title slide
  const titleSlide = {
    type: "title",
    title: `Ôn tập hôm nay · ${dueRes.date}`,
    subtitle,
    icon: "ph:brain-duotone",
  };

  // 3. SRS slides for each card in queue
  const srsSlides: SrsSlide[] = dueRes.queue.map((c) => {
    let originObj: SrsSlideOrigin | undefined = undefined;
    if (c.origin?.href) {
      // The producer supplied a link that opens the exact place (e.g. a Mira player with #stop-3): pass it through.
      originObj = { label: describeOrigin(c), href: c.origin.href };
    } else if (c.origin) {
      let label = "";
      if (c.origin.kind === "rigel-ref") {
        // A rigel-ref card always reads "Tài liệu · <locator>", with or without a link.
        label = describeOrigin(c);
      } else if (c.origin.locator) {
        label = c.deck ? `${c.deck} · ${c.origin.locator}` : c.origin.locator;
      } else if (c.deck) {
        label = c.deck;
      } else {
        label = ORIGIN_KIND_LABELS[c.origin.kind] ?? c.origin.kind;
      }

      let href: string | undefined = undefined;
      if (c.origin.path) {
        const isLesson =
          c.origin.kind.startsWith("aurora-") ||
          c.origin.path.includes("05_Slides") ||
          c.origin.path.endsWith("deck.json") ||
          c.origin.path.endsWith(".html");

        if (isLesson) {
          let targetFile = c.origin.path;
          if (targetFile.endsWith("deck.json")) {
            targetFile = join(dirname(targetFile), "index.html");
          }
          try {
            const rel = relative(sessionDir, targetFile).replace(/\\/g, "/");
            href = rel;
          } catch {
            // cross-drive fallback
          }
        }
      }

      originObj = {
        label,
        ...(href ? { href } : {}),
      };
    }

    return {
      type: "srs",
      id: `srs-${c.id}`,
      card: c.id,
      front: c.front,
      back: c.back,
      ...(c.hint ? { hint: c.hint } : {}),
      ...(c.hook ? { hook: c.hook } : {}),
      ...(originObj ? { origin: originObj } : {}),
    };
  });

  // 4. Summary slide
  const summarySlide = {
    type: "summary",
    title: "Hoàn thành phiên ôn tập!",
    items: [
      `Đã hoàn thành ${dueRes.queue.length} thẻ ôn tập hôm nay.`,
      "Đánh giá của bạn sẽ được tự động đồng bộ vào FSRS qua vega_sync.",
      "Duy trì thói quen ôn tập đều đặn giúp củng cố độ ổn định trí nhớ (Stability).",
    ],
  };

  // 5. Complete deck
  const deck = {
    title: `Ôn tập hôm nay · ${dueRes.date}`,
    theme: "midnight",
    lang: "vi",
    slides: [titleSlide, ...srsSlides, summarySlide],
  };

  await writeJson(deckJsonPath, deck);

  // 6. Optional build with Aurora CLI
  const shouldBuild = options.build !== false;
  let built = false;
  let cliOutput: string | undefined = undefined;

  if (shouldBuild) {
    const cliPath = findAuroraCli();
    if (cliPath) {
      try {
        const out = execFileSync(process.execPath, [cliPath, "build", sessionDir], {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        built = true;
        cliOutput = out.trim();
      } catch (err: unknown) {
        built = false;
        cliOutput = errMsg(err);
      }
    } else {
      built = false;
      cliOutput = "Aurora CLI not found. Call MCP tool aurora_build on the session folder.";
    }
  }

  const studyInstructions = [
    "Cách học phiên này (How to study):",
    `1. Xem trực tiếp có tương tác (khuyến nghị): Gọi tool aurora_preview { dir: "${sessionDir}", open: true }`,
    `2. Hoặc mở trực tiếp file: ${join(sessionDir, "index.html")} trong trình duyệt.`,
    "3. Đánh giá thẻ bằng các phím số: 1 (Again), 2 (Hard), 3 (Good), 4 (Easy) hoặc bấm nút đánh giá.",
    "4. Sau khi học xong, gọi tool vega_sync để cập nhật kết quả vào FSRS.",
  ].join("\n");

  const summary = [
    `Vega Session Created for ${dueRes.date}:`,
    `- Folder: ${sessionDir}`,
    `- Deck: ${deckJsonPath}`,
    `- Cards: ${dueRes.queue.length} (${dueRes.counts.overdue} overdue, ${dueRes.counts.due} due today, ${dueRes.counts.new} new)`,
    `- Build: ${built ? "index.html built successfully via Aurora CLI" : (cliOutput ?? "Not built (call aurora_build)")}`,
    "",
    studyInstructions,
  ].join("\n");

  return {
    date: dueRes.date,
    deck_path: deckJsonPath,
    session_dir: sessionDir,
    card_count: dueRes.queue.length,
    built,
    cli_output: cliOutput,
    study_instructions: studyInstructions,
    summary,
  };
}
