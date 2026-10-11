import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  CardCandidateSchema,
  type CardCandidate,
  type CardKind,
  type OriginKind,
} from "./schema.js";

export interface CandidateExtractOptions {
  from?: "polaris-facts" | "polaris-errorlog" | "aurora-deck" | "auto";
  subject?: string;
}

export async function extractCandidates(
  filePath: string,
  options: CandidateExtractOptions = {},
): Promise<CardCandidate[]> {
  if (!existsSync(filePath)) {
    throw new Error(`Source file not found: ${filePath}`);
  }

  const rawContent = await readFile(filePath, "utf8");
  const mode = options.from && options.from !== "auto" ? options.from : detectSourceType(filePath, rawContent);

  switch (mode) {
    case "polaris-facts":
      return extractPolarisFacts(filePath, rawContent, options.subject);
    case "polaris-errorlog":
      return extractPolarisErrorlog(filePath, rawContent, options.subject);
    case "aurora-deck":
      return extractAuroraDeck(filePath, rawContent, options.subject);
    default:
      throw new Error(
        `Unable to determine candidate source type for file: ${filePath}. Please specify 'from' as 'polaris-facts', 'polaris-errorlog', or 'aurora-deck'.`,
      );
  }
}

function detectSourceType(filePath: string, content: string): "polaris-facts" | "polaris-errorlog" | "aurora-deck" {
  const base = basename(filePath).toLowerCase();
  if (base.includes("fact") && base.endsWith(".json")) return "polaris-facts";
  if (base.includes("errorlog") || base.endsWith(".md")) {
    if (content.includes("Sổ lỗi") || content.includes("Trắc nghiệm sai") || content.includes("Dự đoán sai") || content.includes("ERR_")) {
      return "polaris-errorlog";
    }
  }
  if (base.includes("deck") && base.endsWith(".json")) return "aurora-deck";

  try {
    const parsed = JSON.parse(content);
    if (parsed.slides && Array.isArray(parsed.slides)) return "aurora-deck";
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.claim) return "polaris-facts";
    if (parsed.facts && Array.isArray(parsed.facts)) return "polaris-facts";
  } catch {
    // Markdown or plain text
    if (content.includes("###") || content.includes("Sổ lỗi") || content.includes("ERR_")) {
      return "polaris-errorlog";
    }
  }

  return "aurora-deck";
}

/* ───────── 1. Polaris Facts Extraction ───────── */

interface RawFact {
  id?: string;
  claim?: string;
  source?: string;
  locator?: string;
  label?: string;
  modules?: string[];
  [key: string]: unknown;
}

export function extractPolarisFacts(
  filePath: string,
  content: string,
  defaultSubject?: string,
): CardCandidate[] {
  let facts: RawFact[] = [];
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      facts = parsed;
    } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.facts)) {
      facts = parsed.facts;
    }
  } catch (e) {
    throw new Error(`Failed to parse facts JSON from ${filePath}: ${String(e)}`);
  }

  const candidates: CardCandidate[] = [];

  for (let i = 0; i < facts.length; i++) {
    const f = facts[i];
    if (!f || !f.claim || typeof f.claim !== "string") continue;

    const factId = f.id || `F${i + 1}`;
    const claim = f.claim.trim();
    const locator = f.locator ? String(f.locator) : "";
    const sourceStr = f.source ? ` [Nguồn: ${f.source}${locator ? " " + locator : ""}]` : "";
    const isCloze = claim.includes("[[") && claim.includes("]]");

    const subject = defaultSubject || f.modules?.[0] || "polaris";

    if (isCloze) {
      candidates.push({
        kind: "cloze",
        front: claim,
        back: claim.replace(/\[\[(.*?)\]\]/g, "$1") + (sourceStr ? `\n\n${sourceStr.trim()}` : ""),
        origin: {
          kind: "polaris-fact",
          path: filePath,
          locator: `fact ${factId}${locator ? ` (${locator})` : ""}`,
        },
        tags: ["polaris", "fact", ...(f.modules || [])],
        subject,
      });
    } else {
      candidates.push({
        kind: "basic",
        front: `Dữ kiện [${factId}]: ${claim}`,
        back: `Khẳng định cốt lõi: ${claim}${sourceStr ? `\n\n${sourceStr.trim()}` : ""}`,
        origin: {
          kind: "polaris-fact",
          path: filePath,
          locator: `fact ${factId}${locator ? ` (${locator})` : ""}`,
        },
        tags: ["polaris", "fact", ...(f.modules || [])],
        subject,
      });
    }
  }

  return candidates;
}

/* ───────── 2. Polaris Error Log Extraction ───────── */

export function extractPolarisErrorlog(
  filePath: string,
  content: string,
  defaultSubject?: string,
): CardCandidate[] {
  const candidates: CardCandidate[] = [];
  const sections = content.split(/^###\s+/m).filter((s) => s.trim().length > 0);

  for (const section of sections) {
    const lines = section.split("\n").map((l) => l.trim());
    const heading = lines[0] ?? "";
    if (!heading) continue;

    let entryId = "";
    let question = "";
    let chosen = "";
    let answer = "";
    let explanation = "";
    let prediction = "";
    let actual = "";
    let fix = "";
    let station = "";
    let item = "";
    let hook = "";
    let sourceRef = "";

    for (const line of lines) {
      const matchField = (label: string) => {
        const regex = new RegExp(`^-\\s*\\*\\*${label}:\\*\\*\\s*(.*)$`, "i");
        const m = line.match(regex);
        return m ? m[1]?.trim() : null;
      };

      const mId = matchField("Mã mục");
      if (mId) entryId = mId.replace(/`/g, "");

      const mQ = matchField("Câu hỏi");
      if (mQ) question = mQ;

      const mChosen = matchField("Đã chọn");
      if (mChosen) chosen = mChosen;

      const mAns = matchField("Đáp án đúng");
      if (mAns) answer = mAns;

      const mExp = matchField("Giải thích");
      if (mExp) explanation = mExp;

      const mPred = matchField("Dự đoán");
      if (mPred) prediction = mPred;

      const mAct = matchField("Kết quả thực tế") || matchField("Thực tế");
      if (mAct) actual = mAct;

      const mFix = matchField("Bài học rút ra") || matchField("Sửa lại") || matchField("Nguyên nhân gốc rễ");
      if (mFix && !mFix.includes("(tự điền")) fix = mFix;

      const mStation = matchField("Trạm");
      if (mStation) station = mStation;

      const mItem = matchField("Ý cần nhớ");
      if (mItem) item = mItem;

      const mNeo = matchField("Neo");
      if (mNeo && !mNeo.includes("(tự điền")) hook = mNeo;

      const mRef = matchField("Nguồn / Tham chiếu");
      if (mRef) sourceRef = mRef;
    }

    const locator = entryId || heading;
    const subject = defaultSubject || "polaris";

    if (question && answer) {
      // Quiz error entry
      const front = `Trắc nghiệm cần củng cố: ${question}${chosen ? `\n(Lỗi trước đó: đã chọn ${chosen})` : ""}`;
      const back = `Đáp án đúng: ${answer}${explanation ? `\n\nGiải thích: ${explanation}` : ""}${sourceRef ? `\n\nTham chiếu: ${sourceRef}` : ""}`;
      candidates.push({
        kind: "basic",
        front: front.trim(),
        back: back.trim(),
        origin: {
          kind: "polaris-errorlog",
          path: filePath,
          locator,
        },
        tags: ["polaris", "errorlog", "quiz"],
        subject,
      });
    } else if (prediction || actual || fix) {
      // Prediction / runtime gap entry
      const front = `Lỗ hổng dự đoán (Predict Gap): ${heading}\n${prediction ? `Dự đoán sai: ${prediction}` : ""}`.trim();
      const back = `Thực tế & Bài học cốt lõi:\n${actual ? `- Kết quả: ${actual}\n` : ""}${fix ? `- Khắc phục: ${fix}\n` : ""}${sourceRef ? `\nTham chiếu: ${sourceRef}` : ""}`.trim();
      candidates.push({
        kind: "basic",
        front,
        back,
        origin: {
          kind: "polaris-errorlog",
          path: filePath,
          locator,
        },
        tags: ["polaris", "errorlog", "predict"],
        subject,
      });
    } else if (station && item) {
      // Palace recall error entry
      candidates.push({
        kind: "palace",
        front: `Ôn trạm trí nhớ: ${station}`,
        back: `Ý cần nhớ: ${item}`,
        hook: hook || undefined,
        origin: {
          kind: "polaris-errorlog",
          path: filePath,
          locator,
        },
        tags: ["polaris", "errorlog", "palace"],
        subject,
      });
    } else {
      // Generic error entry
      const bodyLines = lines.slice(1).filter((l) => l.length > 0 && !l.includes("(tự điền"));
      if (bodyLines.length > 0) {
        candidates.push({
          kind: "basic",
          front: `Sổ lỗi: ${heading}`,
          back: bodyLines.join("\n"),
          origin: {
            kind: "polaris-errorlog",
            path: filePath,
            locator,
          },
          tags: ["polaris", "errorlog"],
          subject,
        });
      }
    }
  }

  return candidates;
}

/* ───────── 3. Aurora Deck Extraction ───────── */

interface RawSlide {
  type: string;
  title?: string;
  lines?: Array<string | { term: string; def: string }>;
  question?: string;
  options?: Array<string | { text: string; correct?: boolean; explain?: string }>;
  answer?: number | number[];
  explanation?: string;
  cards?: Array<{ front: string; back: string; hint?: string }>;
  stations?: Array<{ place: string; item: string; hook?: string }>;
  text?: string;
  hint?: string;
  term?: string;
  definition?: string;
  example?: string;
  [key: string]: unknown;
}

interface RawDeck {
  title?: string;
  subject?: string;
  slides?: RawSlide[];
}

interface DeckCandidateEntry {
  candidate: CardCandidate;
  subheading?: string;
}

export function extractFormulaLhs(formula: string): string | null {
  const clean = formula.trim().replace(/^=\s*/, "");
  let depth = 0;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === "{" || ch === "[" || ch === "(") {
      depth++;
    } else if (ch === "}" || ch === "]" || ch === ")") {
      if (depth > 0) depth--;
    } else if (depth === 0) {
      if (clean.slice(i, i + 2) === ":=") {
        const lhs = clean.slice(0, i).trim();
        return lhs.length > 0 && lhs.length <= 50 ? lhs : null;
      }
      if (ch === "=" && clean[i - 1] !== "=" && clean[i + 1] !== "=" && clean[i - 1] !== "!" && clean[i - 1] !== "<" && clean[i - 1] !== ">") {
        const lhs = clean.slice(0, i).trim();
        return lhs.length > 0 && lhs.length <= 50 ? lhs : null;
      }
      const matchOp = clean.slice(i).match(/^(\\approx|\\equiv|\\sim|\\leftarrow)\b/);
      if (matchOp) {
        const lhs = clean.slice(0, i).trim();
        return lhs.length > 0 && lhs.length <= 50 ? lhs : null;
      }
    }
  }
  return null;
}

export function hasFormulaRelationSign(formula: string): boolean {
  const clean = formula.trim().replace(/^=\s*/, "");
  let depth = 0;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === "{" || ch === "[" || ch === "(") {
      depth++;
    } else if (ch === "}" || ch === "]" || ch === ")") {
      if (depth > 0) depth--;
    } else if (depth === 0) {
      if (clean.slice(i, i + 2) === ":=") {
        return true;
      }
      if (ch === "=" && clean[i - 1] !== "=" && clean[i + 1] !== "=" && clean[i - 1] !== "!" && clean[i - 1] !== "<" && clean[i - 1] !== ">") {
        return true;
      }
      const matchOp = clean.slice(i).match(/^(\\approx|\\equiv|\\leftarrow)\b/);
      if (matchOp) {
        return true;
      }
    }
  }
  return false;
}

export function splitNotebookFormulas(formulaLine: string): string[] {
  const trimmed = formulaLine.trim();
  let depth = 0;
  let lastIdx = 0;
  const rawParts: string[] = [];
  let i = 0;

  while (i < trimmed.length) {
    const ch = trimmed[i];
    if (ch === "{" || ch === "[" || ch === "(") {
      depth++;
      i++;
    } else if (ch === "}" || ch === "]" || ch === ")") {
      if (depth > 0) depth--;
      i++;
    } else if (depth === 0) {
      let sepLen = 0;
      if (trimmed.slice(i).startsWith("\\qquad")) {
        const next = trimmed[i + 6];
        if (!next || !/[a-zA-Z]/.test(next)) {
          sepLen = 6;
        }
      } else if (trimmed.slice(i).startsWith("\\quad")) {
        const next = trimmed[i + 5];
        if (!next || !/[a-zA-Z]/.test(next)) {
          sepLen = 5;
        }
      } else if (ch === ";") {
        sepLen = 1;
      }

      if (sepLen > 0) {
        rawParts.push(trimmed.slice(lastIdx, i));
        i += sepLen;
        lastIdx = i;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  rawParts.push(trimmed.slice(lastIdx));

  // Trim commas and spaces around the separators
  const parts = rawParts
    .map((p) => p.trim().replace(/^[\s,]+|[\s,]+$/g, "").trim())
    .filter((p) => p.length > 0);

  if (parts.length <= 1) {
    return [trimmed];
  }

  // Where each part has its own relation sign (=, :=, \approx, \leftarrow, \equiv)
  const allHaveRelation = parts.every((p) => hasFormulaRelationSign(p));
  if (!allHaveRelation) {
    return [trimmed];
  }

  return parts;
}

export function wrapDisplayMath(formula: string): string {
  const trimmed = formula.trim();
  if (trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length >= 4) {
    return trimmed;
  }
  return `$$${trimmed}$$`;
}

export function wrapInlineMath(text: string): string {
  if (text.includes("$")) {
    return text;
  }
  return `$${text}$`;
}

function lowerFirstIfRegular(text: string): string {
  if (/^[A-ZÀ-Ỹ][a-zà-ỹ]/.test(text)) {
    return text.charAt(0).toLowerCase() + text.slice(1);
  }
  return text;
}

export function buildFormulaFront(
  formula: string,
  subheading: string,
  slideLines: Array<string | { term: string; def: string }>,
  currentLineIdx: number,
  slideTitle: string,
): string {
  const lhs = extractFormulaLhs(formula);

  // 1. Nearest preceding "# " sub-heading
  if (subheading && subheading.length > 0) {
    let title = subheading;
    const rawLhs = lhs ? lhs.replace(/\$/g, "").trim() : "";
    const lhsClean = rawLhs ? rawLhs.replace(/\\text\{([^}]+)\}/g, "$1").replace(/[\\{}^_*()]/g, "").trim() : "";
    const lhsStem = lhsClean.toLowerCase().replace(/s$/, "");
    const titleClean = title.replace(/\$/g, "");
    const titleLower = titleClean.toLowerCase();

    const alreadyReferenced = Boolean(
      lhsClean && (
        titleLower.includes(lhsClean.toLowerCase()) ||
        (lhsStem.length >= 3 && titleLower.includes(lhsStem)) ||
        (rawLhs && titleClean.includes(rawLhs))
      )
    );

    if (lhs && !alreadyReferenced) {
      const wrappedLhs = wrapInlineMath(lhs);
      const parenMatch = title.match(/^(.*?)\s*(\([^)]+\))\s*$/);
      if (parenMatch && parenMatch[1] !== undefined && parenMatch[2] !== undefined) {
        title = `${parenMatch[1]} ${wrappedLhs} ${parenMatch[2]}`.trim();
      } else {
        title = `${title} ${wrappedLhs}`.trim();
      }
    }

    if (/^(công thức|viết công thức)\b/i.test(title)) {
      return title.charAt(0).toUpperCase() + title.slice(1);
    }

    return `Công thức ${lowerFirstIfRegular(title)}`;
  }

  // 2. Left-hand side of formula (e.g. "\hat{y}", "J(w)", "w^*")
  if (lhs && lhs.length > 0) {
    const wrappedLhs = wrapInlineMath(lhs);
    return `Viết công thức cho ${wrappedLhs}`;
  }

  // 3. Words around it
  if (slideLines && currentLineIdx !== undefined) {
    for (let k = currentLineIdx - 1; k >= 0; k--) {
      const prev = slideLines[k];
      if (!prev) continue;
      if (typeof prev === "object" && prev !== null && "term" in prev && prev.term) {
        const term = String(prev.term).trim();
        if (/^(công thức|viết công thức)\b/i.test(term)) {
          return term.charAt(0).toUpperCase() + term.slice(1);
        }
        return `Công thức ${lowerFirstIfRegular(term)}`;
      }
      if (typeof prev === "string") {
        const pStr = prev.trim();
        if (!pStr.startsWith("#") && !pStr.startsWith("=") && !pStr.startsWith("!") && !pStr.startsWith("@")) {
          const clean = pStr.replace(/[:：]\s*$/, "").trim();
          if (clean.length > 0) {
            if (/^(công thức|viết công thức)\b/i.test(clean)) {
              return clean.charAt(0).toUpperCase() + clean.slice(1);
            }
            return `Công thức ${lowerFirstIfRegular(clean)}`;
          }
        }
      }
    }
  }

  // Fallback to slide title
  if (slideTitle && slideTitle !== "Ghi chép") {
    if (/^(công thức|viết công thức)\b/i.test(slideTitle)) {
      return slideTitle;
    }
    return `Công thức (${slideTitle})`;
  }

  return "Công thức";
}

function deduplicateCandidateFronts(entries: DeckCandidateEntry[]): CardCandidate[] {
  const seen = new Set<string>();
  const result: CardCandidate[] = [];

  for (const item of entries) {
    let front = item.candidate.front;
    if (seen.has(front)) {
      let base = front;
      if (item.subheading && !front.toLowerCase().includes(item.subheading.toLowerCase())) {
        base = `${front} (${item.subheading})`;
      }

      if (!seen.has(base)) {
        front = base;
      } else {
        let index = 2;
        while (seen.has(`${base} (${index})`)) {
          index++;
        }
        front = `${base} (${index})`;
      }
    }

    seen.add(front);
    result.push({
      ...item.candidate,
      front,
    });
  }

  return result;
}

export function extractAuroraDeck(
  filePath: string,
  content: string,
  defaultSubject?: string,
): CardCandidate[] {
  let deck: RawDeck;
  try {
    deck = JSON.parse(content);
  } catch (e) {
    throw new Error(`Failed to parse Aurora deck JSON from ${filePath}: ${String(e)}`);
  }

  const entries: DeckCandidateEntry[] = [];
  const deckTitle = deck.title || basename(filePath, ".json");
  const subject = defaultSubject || deck.subject || deckTitle;
  const slides = deck.slides || [];

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i]!;
    const slideNum = i + 1;
    const type = slide.type;

    if (type === "notebook" && Array.isArray(slide.lines)) {
      const slideTitle = slide.title || "Ghi chép";
      let currentSubheading = "";

      for (let lineIdx = 0; lineIdx < slide.lines.length; lineIdx++) {
        const line = slide.lines[lineIdx]!;
        if (typeof line === "object" && line !== null && "term" in line && "def" in line) {
          const term = String(line.term).trim();
          const def = String(line.def).trim();

          // 1. Basic (term -> def)
          entries.push({
            candidate: {
              kind: "basic",
              front: term,
              back: def,
              origin: {
                kind: "aurora-notebook",
                path: filePath,
                locator: `slide ${slideNum} (notebook: ${slideTitle})`,
              },
              tags: ["aurora", "notebook", "term"],
              subject,
              deck: deckTitle,
            },
            subheading: currentSubheading || undefined,
          });

          // 2. Reverse (def -> term)
          entries.push({
            candidate: {
              kind: "reverse",
              front: def,
              back: term,
              origin: {
                kind: "aurora-notebook",
                path: filePath,
                locator: `slide ${slideNum} (notebook: ${slideTitle})`,
              },
              tags: ["aurora", "notebook", "reverse"],
              subject,
              deck: deckTitle,
            },
            subheading: currentSubheading || undefined,
          });
        } else if (typeof line === "string") {
          const str = line.trim();
          if (str.startsWith("#")) {
            currentSubheading = str.replace(/^#+\s*/, "").replace(/^\d+[\.\)]\s*/, "").trim();
          } else if (str.startsWith("= ")) {
            const rawFormula = str.slice(2).trim();
            const formulaParts = splitNotebookFormulas(rawFormula);
            for (const formula of formulaParts) {
              const front = buildFormulaFront(formula, currentSubheading, slide.lines, lineIdx, slideTitle);
              entries.push({
                candidate: {
                  kind: "basic",
                  front,
                  back: wrapDisplayMath(formula),
                  origin: {
                    kind: "aurora-notebook",
                    path: filePath,
                    locator: `slide ${slideNum} (notebook)`,
                  },
                  tags: ["aurora", "notebook", "formula"],
                  subject,
                  deck: deckTitle,
                },
                subheading: currentSubheading || undefined,
              });
            }
          } else if (str.startsWith("! ")) {
            const rule = str.slice(2).trim();
            const front = currentSubheading
              ? `Quy tắc cốt lõi · ${currentSubheading}`
              : `Quy tắc cốt lõi: ${slideTitle}`;
            entries.push({
              candidate: {
                kind: "basic",
                front,
                back: rule,
                origin: {
                  kind: "aurora-notebook",
                  path: filePath,
                  locator: `slide ${slideNum} (notebook)`,
                },
                tags: ["aurora", "notebook", "rule"],
                subject,
                deck: deckTitle,
              },
              subheading: currentSubheading || undefined,
            });
          } else if (str.startsWith("@ ")) {
            const hookText = str.slice(2).trim();
            const front = currentSubheading
              ? `Mỏ neo trí nhớ · ${currentSubheading}`
              : `Mỏ neo trí nhớ: ${slideTitle}`;
            entries.push({
              candidate: {
                kind: "basic",
                front,
                back: hookText,
                hook: hookText,
                origin: {
                  kind: "aurora-notebook",
                  path: filePath,
                  locator: `slide ${slideNum} (notebook)`,
                },
                tags: ["aurora", "notebook", "anchor"],
                subject,
                deck: deckTitle,
              },
              subheading: currentSubheading || undefined,
            });
          }
        }
      }
    } else if (type === "quiz" && slide.question) {
      const q = slide.question.trim();
      const options = slide.options || [];
      const correctTexts: string[] = [];

      options.forEach((opt, idx) => {
        let isCorrect = false;
        let optText = "";
        let optExplain = "";

        if (typeof opt === "string") {
          optText = opt;
        } else if (typeof opt === "object" && opt !== null) {
          optText = opt.text || "";
          optExplain = opt.explain || "";
          if (opt.correct === true) isCorrect = true;
        }

        if (slide.answer !== undefined) {
          if (Array.isArray(slide.answer)) {
            if (slide.answer.includes(idx)) isCorrect = true;
          } else if (slide.answer === idx) {
            isCorrect = true;
          }
        }

        if (isCorrect) {
          correctTexts.push(optText + (optExplain ? ` (${optExplain})` : ""));
        }
      });

      const explanation = slide.explanation ? `\n\nGiải thích: ${slide.explanation.trim()}` : "";
      const backText = correctTexts.length > 0 ? `Đáp án đúng: ${correctTexts.join(", ")}${explanation}` : explanation.trim();

      entries.push({
        candidate: {
          kind: "basic",
          front: q,
          back: backText || "Xem giải thích trong bài học.",
          origin: {
            kind: "aurora-quiz",
            path: filePath,
            locator: `slide ${slideNum} (quiz)`,
          },
          tags: ["aurora", "quiz"],
          subject,
          deck: deckTitle,
        },
      });
    } else if (type === "flashcards" && Array.isArray(slide.cards)) {
      for (const card of slide.cards) {
        if (!card.front || !card.back) continue;
        entries.push({
          candidate: {
            kind: "basic",
            front: card.front.trim(),
            back: card.back.trim(),
            hint: card.hint ? card.hint.trim() : undefined,
            origin: {
              kind: "aurora-flashcard",
              path: filePath,
              locator: `slide ${slideNum} (flashcards)`,
            },
            tags: ["aurora", "flashcards"],
            subject,
            deck: deckTitle,
          },
        });
      }
    } else if (type === "palace" && Array.isArray(slide.stations)) {
      const palaceTitle = slide.title || "Lộ trình trí nhớ";
      for (const station of slide.stations) {
        if (!station.place || !station.item) continue;
        entries.push({
          candidate: {
            kind: "palace",
            front: `${palaceTitle} · Trạm: ${station.place.trim()}`,
            back: station.item.trim(),
            hook: station.hook ? station.hook.trim() : undefined,
            origin: {
              kind: "aurora-palace",
              path: filePath,
              locator: `slide ${slideNum} (palace), station: ${station.place.trim()}`,
            },
            tags: ["aurora", "palace"],
            subject,
            deck: deckTitle,
          },
        });
      }
    } else if (type === "cloze" && slide.text) {
      const text = slide.text.trim();
      entries.push({
        candidate: {
          kind: "cloze",
          front: text,
          back: text.replace(/\[\[(.*?)\]\]/g, "$1"),
          hint: slide.hint ? slide.hint.trim() : undefined,
          origin: {
            kind: "aurora-notebook",
            path: filePath,
            locator: `slide ${slideNum} (cloze)`,
          },
          tags: ["aurora", "cloze"],
          subject,
          deck: deckTitle,
        },
      });
    } else if (type === "definition" && slide.term && slide.definition) {
      const term = slide.term.trim();
      const def = slide.definition.trim();
      const example = slide.example ? `\n\nVí dụ: ${slide.example.trim()}` : "";
      entries.push({
        candidate: {
          kind: "basic",
          front: `Định nghĩa: ${term}`,
          back: `${def}${example}`,
          origin: {
            kind: "aurora-notebook",
            path: filePath,
            locator: `slide ${slideNum} (definition: ${term})`,
          },
          tags: ["aurora", "definition"],
          subject,
          deck: deckTitle,
        },
      });
    }
  }

  return deduplicateCandidateFronts(entries);
}
