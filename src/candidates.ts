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

  const candidates: CardCandidate[] = [];
  const deckTitle = deck.title || basename(filePath, ".json");
  const subject = defaultSubject || deck.subject || deckTitle;
  const slides = deck.slides || [];

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i]!;
    const slideNum = i + 1;
    const type = slide.type;

    if (type === "notebook" && Array.isArray(slide.lines)) {
      const slideTitle = slide.title || "Ghi chép";
      for (const line of slide.lines) {
        if (typeof line === "object" && line !== null && "term" in line && "def" in line) {
          const term = String(line.term).trim();
          const def = String(line.def).trim();

          // 1. Basic (term -> def)
          candidates.push({
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
          });

          // 2. Reverse (def -> term)
          candidates.push({
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
          });
        } else if (typeof line === "string") {
          const str = line.trim();
          if (str.startsWith("= ")) {
            const formula = str.slice(2).trim();
            candidates.push({
              kind: "basic",
              front: `Công thức (${slideTitle})`,
              back: formula,
              origin: {
                kind: "aurora-notebook",
                path: filePath,
                locator: `slide ${slideNum} (notebook)`,
              },
              tags: ["aurora", "notebook", "formula"],
              subject,
              deck: deckTitle,
            });
          } else if (str.startsWith("! ")) {
            const rule = str.slice(2).trim();
            candidates.push({
              kind: "basic",
              front: `Quy tắc cốt lõi: ${slideTitle}`,
              back: rule,
              origin: {
                kind: "aurora-notebook",
                path: filePath,
                locator: `slide ${slideNum} (notebook)`,
              },
              tags: ["aurora", "notebook", "rule"],
              subject,
              deck: deckTitle,
            });
          } else if (str.startsWith("@ ")) {
            const hookText = str.slice(2).trim();
            candidates.push({
              kind: "basic",
              front: `Mỏ neo trí nhớ: ${slideTitle}`,
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

      candidates.push({
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
      });
    } else if (type === "flashcards" && Array.isArray(slide.cards)) {
      for (const card of slide.cards) {
        if (!card.front || !card.back) continue;
        candidates.push({
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
        });
      }
    } else if (type === "palace" && Array.isArray(slide.stations)) {
      const palaceTitle = slide.title || "Lộ trình trí nhớ";
      for (const station of slide.stations) {
        if (!station.place || !station.item) continue;
        candidates.push({
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
        });
      }
    } else if (type === "cloze" && slide.text) {
      const text = slide.text.trim();
      candidates.push({
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
      });
    } else if (type === "definition" && slide.term && slide.definition) {
      const term = slide.term.trim();
      const def = slide.definition.trim();
      const example = slide.example ? `\n\nVí dụ: ${slide.example.trim()}` : "";
      candidates.push({
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
      });
    }
  }

  return candidates;
}
