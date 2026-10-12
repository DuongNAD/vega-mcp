#!/usr/bin/env node
/**
 * End-to-end test over real MCP stdio for Vega MCP.
 *
 * Exercises all 12 tools, FSRS behavior against ts-fsrs for fixed card & dates,
 * candidate extraction with origins from copied real Aurora deck & Polaris fixtures,
 * de-duplication, due ordering, daily limits, review state progression, review log persistence,
 * stats computation, atomic writes, the card inbox (contract vega-card-inbox.v1: strict validation,
 * key de-duplication, done/ and rejected/, idempotency, vega_sync integration, session origin labels),
 * and CLI commands on a temporary directory under %TEMP%. Every fixture lives under %TEMP%.
 *
 *   node scripts/e2e.mjs
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base =
  process.platform === "win32"
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "aurora-slides")
    : join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "aurora-slides");

const TOOL = resolve(
  process.env.VEGA_TOOLCHAIN ??
    process.env.POLARIS_TOOLCHAIN ??
    join(base, "toolchain"),
);

const req = createRequire(join(TOOL, "package.json"));
const { Client } = req("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = req("@modelcontextprotocol/sdk/client/stdio.js");

// Import bundled library from dist/vega.mjs
const vegaLib = await import(pathToFileURL(join(ROOT, "dist", "vega.mjs")).href);

const TEST_DIR = join(tmpdir(), `vega_e2e_${Date.now()}`);
rmSync(TEST_DIR, { recursive: true, force: true });
mkdirSync(TEST_DIR, { recursive: true });

process.env.VEGA_HUB = TEST_DIR;

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
};
const textOf = (r) => (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");

/* ───────── Inbox fixture helpers (contract vega-card-inbox.v1) ───────── */

const inboxDirOf = (hub) => join(hub, ".vega", "inbox");
const toJsonl = (lines) => lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n";
const writeInboxFile = (hub, name, lines) => {
  mkdirSync(inboxDirOf(hub), { recursive: true });
  writeFileSync(join(inboxDirOf(hub), name), toJsonl(lines), "utf8");
};
const readJsonl = (file) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
const readCards = (hub) => JSON.parse(readFileSync(join(hub, ".vega", "cards.json"), "utf8")).cards;
/** Every file and folder under dir with size and mtime, so "no writes" can be asserted exactly. */
const treeSnapshot = (dir) => {
  const out = [];
  const walk = (d, rel) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, ent.name);
      const name = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        out.push(`${name}/`);
        walk(path, name);
      } else {
        const st = statSync(path);
        out.push(`${name}|${st.size}|${st.mtimeMs}`);
      }
    }
  };
  if (existsSync(dir)) walk(dir, "");
  return out.sort().join("\n");
};
const stopHref = (slug, k) => `file:///C:/fixtures/${slug}.html#stop-${k}`;
/** A valid Mira line; override any field. */
const mkLine = (over = {}) => ({
  v: 1,
  t: "2026-10-12T08:00:00+07:00",
  producer: "mira",
  key: "mira:vong-lap-for:stop-1",
  subject: "Python_Basics",
  deck: "Vòng lặp for",
  kind: "basic",
  front: "Dò `tong_chu_so(-4567)`: sau dòng 6 ở vòng lặp đầu, `tong` bằng bao nhiêu?",
  back: "Giá trị thật và lý do.",
  origin: {
    kind: "mira-stop",
    path: "Python_Basics/mira/vong-lap-for.html",
    locator: "stop-1",
    href: stopHref("vong-lap-for", 1),
  },
  tags: ["python"],
  reason: "Dự đoán sai ở điểm dừng 1",
  ...over,
});
const miraStop = (k, over = {}) =>
  mkLine({
    key: `mira:vong-lap-for:stop-${k}`,
    t: `2026-10-12T08:${String(k).padStart(2, "0")}:00+07:00`,
    origin: {
      kind: "mira-stop",
      path: "Python_Basics/mira/vong-lap-for.html",
      locator: `stop-${k}`,
      href: stopHref("vong-lap-for", k),
    },
    reason: `Dự đoán sai ở điểm dừng ${k}`,
    ...over,
  });

/* ───────── 1. Fixture Setup ───────── */

console.log("\n--- Setting up Fixtures in Temp Directory ---");

// 1.1 Copy real Aurora deck fixture
const realDeckSource = "D:/02_Learning_Knowledge/AMD_AI_Academy_AI_Agents_101/05_Slides/ai-agents-101/01-vong-lap-agent/deck.json";
const tempDeckPath = join(TEST_DIR, "aurora_deck.json");
if (existsSync(realDeckSource)) {
  copyFileSync(realDeckSource, tempDeckPath);
  ok("copied real Aurora deck fixture", existsSync(tempDeckPath), tempDeckPath);
} else {
  // Fallback inline fixture if external path is absent
  const fallbackDeck = {
    title: "Vòng lặp agent: Ai làm gì trong ReAct?",
    slides: [
      {
        type: "palace",
        id: "palace-agent-loop",
        title: "7 Bước Vòng Lặp Agent",
        stations: [
          { place: "1. Cửa ra vào", item: "Nhận mục tiêu", hook: "Khách bấm chuông đưa giấy" },
          { place: "2. Kệ giày", item: "Ghép Prompt", hook: "Xếp tài liệu vào cặp" },
        ],
      },
      {
        type: "notebook",
        title: "Sổ tay kiến trúc Vòng lặp Agent",
        lines: [
          { term: "ReAct", def: "LLM suy luận (Thought), Code thực thi (Action -> Observation)" },
          "= \\text{Tokens} = T \\cdot p + k \\cdot \\frac{T(T-1)}{2}",
          "! LLM chỉ đề xuất; Code nắm quyền thực thi và dừng",
          "@ Cầu dao bếp reo chuông = max_iterations ngắt vòng lặp",
        ],
      },
      {
        type: "quiz",
        question: "Trong vòng lặp ReAct chuẩn, khi LLM sinh ra 'Final Answer: ...', điều gì xảy ra?",
        options: [
          { text: "Vòng lặp kết thúc ngay lập tức và trả kết quả, không chạy thêm tool.", correct: true },
          { text: "Code thực thi lệnh Action trước đó rồi mới kết thúc.", correct: false },
        ],
        answer: 0,
        explanation: "Final Answer là điều kiện dừng thoát ngay lập tức.",
      },
    ],
  };
  writeFileSync(tempDeckPath, JSON.stringify(fallbackDeck, null, 2), "utf8");
  ok("created fallback Aurora deck fixture", true);
}

// 1.2 Polaris facts.json fixture
const tempFactsPath = join(TEST_DIR, "polaris_facts.json");
const factsData = [
  {
    id: "F1",
    claim: "LLMs provide the reasoning, but tools define the actions",
    source: "S1",
    locator: "[p. 2]",
    label: "course",
    modules: ["M1"],
  },
  {
    id: "F2",
    claim: "ReAct interleaves [[reasoning traces]] and [[action execution]] to reduce hallucinations",
    source: "S2",
    locator: "Section 2",
    label: "extension",
    modules: ["M1"],
  },
];
writeFileSync(tempFactsPath, JSON.stringify(factsData, null, 2), "utf8");
ok("created Polaris facts fixture", existsSync(tempFactsPath));

// 1.3 Polaris errorlog.md fixture
const tempErrorlogPath = join(TEST_DIR, "polaris_errorlog.md");
const errorlogData = `# Sổ lỗi (Error Log)

### [2026-10-15] Trắc nghiệm sai - Module M1 (01-vong-lap-agent)
- **Mã mục:** \`ERR_2026-10-15_a1b2c3\`
- **Ngày ghi nhận:** 2026-10-15
- **Câu hỏi:** ReAct agent khác gì so với Chain-of-Thought tiêu chuẩn?
- **Đã chọn:** Chỉ dùng duy nhất một prompt dài
- **Đáp án đúng:** Xen kẽ bước suy luận Thought và hành động Action với công cụ
- **Giải thích:** ReAct bổ sung vòng tương tác với môi trường bên ngoài thay vì chỉ sinh chuỗi suy nghĩ nội tại.
- **Nguồn / Tham chiếu:** Slide 3

### [2026-10-15] Dự đoán sai - Module M1 (01-vong-lap-agent)
- **Mã mục:** \`ERR_2026-10-15_d4e5f6\`
- **Ngày ghi nhận:** 2026-10-15
- **Dự đoán:** regex parse khớp mọi biểu thức ngoặc lồng
- **Kết quả thực tế:** calculator báo syntax error vì regex dừng ở dấu đóng đầu tiên
- **Bài học rút ra:** Dùng bộ đếm độ sâu ngoặc hoặc parser đệ quy
- **Nguồn / Tham chiếu:** Lab 1 dòng 120
`;
writeFileSync(tempErrorlogPath, errorlogData, "utf8");
ok("created Polaris errorlog fixture", existsSync(tempErrorlogPath));

/* ───────── 2. Offline FSRS Unit Checks against ts-fsrs ───────── */

console.log("\n--- Offline FSRS Algorithm Checks ---");

const emptyCard = vegaLib.initFsrsState(new Date("2026-10-11T10:00:00.000Z"));
ok("empty card has initial state New (0)", emptyCard.state === 0 && emptyCard.reps === 0 && emptyCard.lapses === 0);

// Step 1: Good review at 2026-10-11 10:00
const step1 = vegaLib.stepFsrs(emptyCard, "good", new Date("2026-10-11T10:00:00.000Z"), {
  request_retention: 0.9,
  enable_fuzz: false,
});
ok(
  "step 1 (Good): state -> Learning (1)",
  step1.nextState.state === 1 && step1.nextState.reps === 1 && step1.nextState.lapses === 0,
  `stability: ${step1.nextState.stability}, due: ${step1.nextState.due}`,
);

// Step 2: Second Good review at due date
const dueStep1 = new Date(step1.nextState.due);
const step2 = vegaLib.stepFsrs(step1.nextState, "good", dueStep1, {
  request_retention: 0.9,
  enable_fuzz: false,
});
ok(
  "step 2 (Good): state -> Review (2) and scheduled_days >= 1",
  step2.nextState.state === 2 && step2.nextState.reps === 2 && step2.scheduledDays >= 1,
  `scheduled_days: ${step2.scheduledDays}, stability: ${step2.nextState.stability}`,
);

// Step 3: Again review causes lapse
const dueStep2 = new Date(step2.nextState.due);
const step3Again = vegaLib.stepFsrs(step2.nextState, "again", dueStep2, {
  request_retention: 0.9,
  enable_fuzz: false,
});
ok(
  "step 3 (Again): lapses incremented to 1, state -> Relearning (3)",
  step3Again.nextState.lapses === 1 && step3Again.nextState.state === 3,
  `lapses: ${step3Again.nextState.lapses}, state: ${step3Again.nextState.state}`,
);

// Preview intervals check
const previews = vegaLib.previewFsrsIntervals(step2.nextState, dueStep2, {
  request_retention: 0.9,
  enable_fuzz: false,
});
ok(
  "preview intervals returns 4 ratings with proper state transitions",
  Boolean(previews.again && previews.hard && previews.good && previews.easy) &&
    previews.again.state === "Relearning" &&
    previews.good.scheduled_days >= previews.hard.scheduled_days &&
    previews.easy.scheduled_days >= previews.good.scheduled_days,
  `Again: ${previews.again.scheduled_days}d (${previews.again.state}), Good: ${previews.good.scheduled_days}d, Easy: ${previews.easy.scheduled_days}d`,
);

/* ───────── 3. Candidate Extraction Checks with Origins ───────── */

console.log("\n--- Candidate Extraction Checks ---");

// 3.1 Extract from Aurora Deck
const auroraCandidates = await vegaLib.extractCandidates(tempDeckPath);
ok(
  "extract candidates from Aurora deck",
  auroraCandidates.length >= 4,
  `Found ${auroraCandidates.length} candidate(s)`,
);

const notebookTerm = auroraCandidates.find((c) => c.kind === "basic" && c.front === "ReAct");
const notebookReverse = auroraCandidates.find((c) => c.kind === "reverse" && c.back === "ReAct");
ok(
  "extracted basic and reverse pair from notebook lines",
  Boolean(notebookTerm) && Boolean(notebookReverse) && notebookTerm.back.includes("LLM suy luận"),
  `term: ${notebookTerm?.front}, reverse: ${notebookReverse?.front?.slice(0, 40)}`,
);
ok(
  "notebook candidates carry slide locator in origin",
  Boolean(notebookTerm?.origin?.locator && notebookTerm.origin.locator.includes("slide")),
  `locator: ${notebookTerm?.origin?.locator}`,
);

const formulaCandidate = auroraCandidates.find((c) => c.front.includes("Công thức"));
ok(
  "extracted formula candidate",
  Boolean(formulaCandidate) && formulaCandidate.back.includes("Tokens"),
  formulaCandidate?.back,
);

const palaceCandidate = auroraCandidates.find((c) => c.kind === "palace" && c.front.includes("Cửa ra vào"));
ok(
  "extracted palace station candidate with memory hook",
  Boolean(palaceCandidate) && Boolean(palaceCandidate.hook),
  `Station: ${palaceCandidate?.front}, Hook: ${palaceCandidate?.hook}`,
);

const quizCandidate = auroraCandidates.find((c) => c.origin.kind === "aurora-quiz");
ok(
  "extracted quiz candidate with correct answer and explanation",
  Boolean(quizCandidate) && quizCandidate.back.includes("Đáp án đúng"),
  quizCandidate?.back?.slice(0, 60),
);

// 3.1b Specific notebook candidate fronts (v0.2.2)
const specificDeckPath = join(TEST_DIR, "specific_formula_deck.json");
const specificDeck = {
  title: "Toán học và Học máy cơ bản",
  slides: [
    {
      type: "notebook",
      title: "Hồi quy tuyến tính",
      lines: [
        "= \\hat{y} = \\sigma(w^T x + b)",
        "# 1. Hàm mất mát J(w) (MSE)",
        "= J(w) = \\frac{1}{2m} \\sum_{i=1}^m (h_w(x^{(i)}) - y^{(i)})^2",
        "# 2. Tối ưu hóa trọng số w*",
        "= w^* = (X^T X)^{-1} X^T y",
        "# 3. Quy tắc huấn luyện",
        "! Chuẩn hóa dữ liệu trước khi train",
        "! Giới hạn số vòng lặp tối đa",
        "@ Kim la bàn hội tụ",
      ],
    },
  ],
};
writeFileSync(specificDeckPath, JSON.stringify(specificDeck, null, 2), "utf8");
const specificCandidates = await vegaLib.extractCandidates(specificDeckPath);

const formulaCards = specificCandidates.filter((c) => c.tags?.includes("formula"));
const distinctFronts = new Set(formulaCards.map((c) => c.front));
const formulaUnderNone = formulaCards.find((c) => c.back.includes("\\hat{y}"));
const formulaSub1 = formulaCards.find((c) => c.back.includes("J(w)"));
const formulaSub2 = formulaCards.find((c) => c.back.includes("w^*"));

ok(
  "a fixture notebook with two formulas under different sub-headings and one under none yields three distinct, specific fronts",
  formulaCards.length === 3 &&
    distinctFronts.size === 3 &&
    formulaUnderNone?.front === "Viết công thức cho $\\hat{y}$" &&
    formulaSub1?.front === "Công thức hàm mất mát J(w) (MSE)" &&
    formulaSub2?.front.toLowerCase().includes("tối ưu hóa"),
  formulaCards.map((c) => c.front).join(" | "),
);

const ruleCards = specificCandidates.filter((c) => c.tags?.includes("rule"));
const hookCards = specificCandidates.filter((c) => c.tags?.includes("anchor"));
ok(
  "notebook rule and hook candidates use sub-heading context without repeating slide title",
  ruleCards.length === 2 &&
    ruleCards[0].front !== ruleCards[1].front &&
    ruleCards[0].front === "Quy tắc cốt lõi · Quy tắc huấn luyện" &&
    ruleCards[1].front === "Quy tắc cốt lõi · Quy tắc huấn luyện (2)" &&
    hookCards[0]?.front === "Mỏ neo trí nhớ · Quy tắc huấn luyện",
  ruleCards.map((c) => c.front).join(" | "),
);

const allSpecificFronts = specificCandidates.map((c) => c.front);
ok(
  "all candidate fronts in deck are unique",
  new Set(allSpecificFronts).size === allSpecificFronts.length,
  `Total: ${allSpecificFronts.length}, Unique: ${new Set(allSpecificFronts).size}`,
);

// 3.1c Multi-formula splitting and KaTeX math delimiters (v0.2.2)
const splitDeckPath = join(TEST_DIR, "split_formula_deck.json");
const splitDeck = {
  title: "Machine Learning Math",
  slides: [
    {
      type: "notebook",
      title: "Hồi quy tuyến tính",
      lines: [
        "# OLS & Hàm mất mát",
        "= \\hat{y} = Xw + b, \\quad J(w) = \\frac{1}{n}\\sum (y - \\hat{y})^2",
        "# Quy tắc OLS",
        "! Không giải trực tiếp nghịch đảo ma trận suy biến",
        "@ Chiếc compa đo góc vuông",
      ],
    },
  ],
};
writeFileSync(splitDeckPath, JSON.stringify(splitDeck, null, 2), "utf8");
const splitCandidates = await vegaLib.extractCandidates(splitDeckPath);

const splitFormulas = splitCandidates.filter((c) => c.tags?.includes("formula"));
ok(
  "multi-formula line gives two formula candidates",
  splitFormulas.length === 2,
  `Got ${splitFormulas.length} formula cards`,
);

const splitYHat = splitFormulas.find((c) => c.front.includes("$\\hat{y}$"));
const splitJw = splitFormulas.find((c) => c.front.includes("$J(w)$"));
ok(
  "split formula candidate fronts contain $\\hat{y}$ and $J(w)$ and backs start with $$",
  Boolean(splitYHat && splitJw && splitYHat.back.startsWith("$$") && splitJw.back.startsWith("$$")),
  `y_hat: ${splitYHat?.front} -> ${splitYHat?.back} | Jw: ${splitJw?.front} -> ${splitJw?.back}`,
);

const splitRules = splitCandidates.filter((c) => c.tags?.includes("rule"));
const splitHooks = splitCandidates.filter((c) => c.tags?.includes("anchor"));
ok(
  "split notebook rule and hook fronts follow point 3 (Quy tắc cốt lõi · <sub-heading>)",
  splitRules[0]?.front === "Quy tắc cốt lõi · Quy tắc OLS" &&
    splitHooks[0]?.front === "Mỏ neo trí nhớ · Quy tắc OLS",
  `Rule: ${splitRules[0]?.front} | Hook: ${splitHooks[0]?.front}`,
);

// 3.2 Extract from Polaris facts.json
const factsCandidates = await vegaLib.extractCandidates(tempFactsPath);
ok(
  "extract candidates from Polaris facts.json",
  factsCandidates.length === 2,
  `Found ${factsCandidates.length} facts`,
);
const clozeFact = factsCandidates.find((c) => c.kind === "cloze");
ok(
  "extracted cloze candidate from fact with [[...]]",
  Boolean(clozeFact) && clozeFact.front.includes("[[reasoning traces]]"),
  clozeFact?.front?.slice(0, 50),
);
ok(
  "facts candidate carries fact id locator in origin",
  Boolean(clozeFact?.origin?.locator && clozeFact.origin.locator.includes("fact F2")),
  clozeFact?.origin?.locator,
);

// 3.3 Extract from Polaris errorlog.md
const errorlogCandidates = await vegaLib.extractCandidates(tempErrorlogPath);
ok(
  "extract candidates from Polaris errorlog.md",
  errorlogCandidates.length === 2,
  `Found ${errorlogCandidates.length} error entries`,
);
const quizErrorCandidate = errorlogCandidates.find((c) => c.front.includes("Chain-of-Thought"));
ok(
  "extracted quiz error candidate with correct answer",
  Boolean(quizErrorCandidate) && quizErrorCandidate.back.includes("Xen kẽ bước suy luận Thought"),
  quizErrorCandidate?.back?.slice(0, 60),
);

/* ───────── 4. Real MCP Server Stdio Tests ───────── */

console.log("\n--- Real MCP Server Stdio Tests ---");

const client = new Client({ name: "vega-e2e", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(ROOT, "dist", "vega.mjs")],
  stderr: "inherit",
  env: {
    ...process.env,
    VEGA_HUB: TEST_DIR,
  },
});

await client.connect(transport);
const call = (name, args = {}) => client.callTool({ name, arguments: args }, undefined, { timeout: 30000 });

const fixtureProgressFile = join(TEST_DIR, "fixture_progress.jsonl");

try {
  // 4.1 Server Identification and Instructions
  const info = client.getServerVersion();
  ok("server identifies itself as vega", info?.name === "vega" && info?.version === "0.3.0", `${info?.name} ${info?.version}`);

  const instructions = client.getInstructions() ?? "";
  ok(
    "server sends instructions with Workflow and Rules",
    instructions.includes("Workflow:") && instructions.includes("Rules:") && instructions.includes("FSRS"),
  );
  ok(
    "server instructions put vega_inbox in the workflow and say vega_sync ingests the inbox",
    instructions.includes('vega_inbox { action: "list" | "ingest"') &&
      instructions.includes("inbox/done/") &&
      instructions.includes("vega_sync { file? } to ingest the inbox first") &&
      instructions.includes("single review queue"),
  );

  // 4.2 List Tools
  const { tools } = await client.listTools();
  const toolNames = tools.map((t) => t.name).sort();
  ok(
    "all 12 tools registered",
    toolNames.length === 12 &&
      toolNames.includes("vega_inbox") &&
      toolNames.includes("vega_guide") &&
      toolNames.includes("vega_candidates") &&
      toolNames.includes("vega_add") &&
      toolNames.includes("vega_edit") &&
      toolNames.includes("vega_suspend") &&
      toolNames.includes("vega_delete") &&
      toolNames.includes("vega_due") &&
      toolNames.includes("vega_review") &&
      toolNames.includes("vega_stats") &&
      toolNames.includes("vega_session") &&
      toolNames.includes("vega_sync"),
    toolNames.join(", "),
  );

  // 4.2b List & Get Prompts
  const { prompts } = await client.listPrompts();
  const promptNames = prompts.map((p) => p.name).sort();
  ok(
    "prompts review_today and make_cards registered",
    promptNames.includes("review_today") && promptNames.includes("make_cards"),
    promptNames.join(", "),
  );

  const reviewTodayPrompt = await client.getPrompt({ name: "review_today", arguments: {} });
  const reviewTodayText = reviewTodayPrompt.messages?.[0]?.content?.text ?? "";
  ok(
    "review_today prompt guides vega_sync -> vega_session -> study -> vega_sync",
    reviewTodayText.includes("vega_sync") &&
      reviewTodayText.includes("vega_session") &&
      reviewTodayText.includes("aurora_preview"),
  );

  const makeCardsPrompt = await client.getPrompt({ name: "make_cards", arguments: { path: tempDeckPath } });
  const makeCardsText = makeCardsPrompt.messages?.[0]?.content?.text ?? "";
  ok(
    "make_cards prompt guides candidates -> rewrite -> add",
    makeCardsText.includes("vega_candidates") && makeCardsText.includes("vega_add"),
  );

  // 4.3 vega_guide
  let r = await call("vega_guide");
  ok("vega_guide overview", !r.isError && textOf(r).includes("Available guide topics"), textOf(r).split("\n")[0]);
  r = await call("vega_guide", { topic: "rules" });
  ok("vega_guide rules topic", !r.isError && textOf(r).includes("One Idea per Card") && textOf(r).includes("Dùng Cloze"));
  r = await call("vega_guide", { topic: "fsrs" });
  ok("vega_guide fsrs topic", !r.isError && textOf(r).includes("Stability") && textOf(r).includes("Difficulty"));
  r = await call("vega_guide", { topic: "workflows" });
  ok("vega_guide workflows topic", !r.isError && textOf(r).includes("Discovery") && textOf(r).includes("vega_session"));
  r = await call("vega_guide", { topic: "session" });
  ok("vega_guide session topic", !r.isError && textOf(r).includes("vega_session") && textOf(r).includes("progress.jsonl"));


  // 4.4 vega_candidates tool
  r = await call("vega_candidates", { path: tempDeckPath });
  ok("vega_candidates tool extracts deck", !r.isError && textOf(r).includes("candidate card(s)"));

  // 4.5 vega_add tool
  const cardsToAdd = [
    {
      subject: "AI Agents 101",
      deck: "01-vong-lap-agent",
      kind: "basic",
      front: "Trong ReAct, LLM và Code Python phân định ranh giới thế nào?",
      back: "LLM chỉ đề xuất suy luận (Thought/Action text); Code Python nắm quyền thực thi công cụ và dừng vòng lặp.",
      origin: {
        kind: "aurora-notebook",
        path: tempDeckPath,
        locator: "slide 12 (notebook)",
      },
      tags: ["react", "architecture"],
      created: "2026-10-11T08:00:00.000Z",
    },
    {
      subject: "AI Agents 101",
      deck: "01-vong-lap-agent",
      kind: "palace",
      front: "Vòng lặp ReAct · Trạm 7: Bếp nấu",
      back: "Kiểm tra ngân sách (max_steps)",
      hook: "Đồng hồ hẹn giờ bếp reo reng reng; nếu đếm quá 6 lần mà chưa xong thì cầu dao tự ngắt điện.",
      origin: {
        kind: "aurora-palace",
        path: tempDeckPath,
        locator: "slide 8 (palace), station: 7. Bếp nấu",
      },
      tags: ["react", "palace"],
      created: "2026-10-11T08:05:00.000Z",
    },
    {
      subject: "AI Agents 101",
      deck: "01-vong-lap-agent",
      kind: "cloze",
      front: "Chi phí token tích lũy của vòng lặp ReAct tăng theo cấp số [[bậc hai O(T^2)]].",
      back: "Chi phí token tích lũy của vòng lặp ReAct tăng theo cấp số bậc hai O(T^2).",
      origin: {
        kind: "aurora-notebook",
        path: tempDeckPath,
        locator: "slide 12 (formula)",
      },
      tags: ["react", "tokens"],
      created: "2026-10-11T08:10:00.000Z",
    },
    {
      subject: "AI Agents 101",
      kind: "basic",
      front: "Khái niệm ReAct",
      back: "Reasoning and Acting synergized in language models",
      origin: {
        kind: "polaris-fact",
        path: tempFactsPath,
        locator: "fact F1",
      },
      tags: ["polaris"],
      created: "2026-10-11T08:15:00.000Z",
    },
  ];

  r = await call("vega_add", { cards: cardsToAdd, hub: TEST_DIR });
  ok("vega_add adds 4 cards", !r.isError && textOf(r).includes("Added 4 card(s)"));

  const cardsJsonFile = join(TEST_DIR, ".vega", "cards.json");
  ok("cards.json written under .vega/", existsSync(cardsJsonFile));

  const collectionData = JSON.parse(readFileSync(cardsJsonFile, "utf8"));
  ok("collection has 4 cards with FSRS state", collectionData.cards.length === 4 && collectionData.cards[0].fsrs.state === 0);

  const card1Id = collectionData.cards[0].id;
  const card2Id = collectionData.cards[1].id;
  const card3Id = collectionData.cards[2].id;
  const card4Id = collectionData.cards[3].id;

  // 4.6 De-duplication check: adding same cards again skips duplicates
  r = await call("vega_add", { cards: cardsToAdd, hub: TEST_DIR });
  ok("vega_add skips duplicates", !r.isError && textOf(r).includes("Skipped 4 duplicate(s)") && textOf(r).includes("Added 0 card(s)"));

  // 4.7 vega_edit
  r = await call("vega_edit", {
    id: card1Id,
    patch: {
      hint: "Nhớ câu: Same brain, different tools",
    },
    hub: TEST_DIR,
  });
  ok("vega_edit updates card hint", !r.isError && textOf(r).includes("Same brain, different tools"));

  // 4.8 vega_suspend
  r = await call("vega_suspend", { id: card4Id, suspended: true, hub: TEST_DIR });
  ok("vega_suspend suspends card", !r.isError && textOf(r).includes("SUSPENDED"));

  // 4.9 vega_due
  r = await call("vega_due", {
    date: "2026-10-11",
    hub: TEST_DIR,
    new_limit: 10,
  });
  ok("vega_due returns queue with active cards", !r.isError && textOf(r).includes("Total in queue: 3"));
  ok("vega_due excludes suspended card", !textOf(r).includes(card4Id));
  ok("vega_due includes 7-day forecast", textOf(r).includes("7-day forecast:"));

  // 4.10 vega_review
  r = await call("vega_review", {
    id: card1Id,
    rating: "good",
    date: "2026-10-11T10:00:00.000Z",
    ms: 4500,
    hub: TEST_DIR,
  });
  ok("vega_review processes good rating", !r.isError && textOf(r).includes("New -> Learning") && textOf(r).includes("Stability:"));

  const reviewsJsonlFile = join(TEST_DIR, ".vega", "reviews.jsonl");
  ok("reviews.jsonl exists", existsSync(reviewsJsonlFile));
  const reviewLines = readFileSync(reviewsJsonlFile, "utf8").trim().split("\n");
  ok("reviews.jsonl contains 1 log entry", reviewLines.length === 1 && reviewLines[0].includes('"rating":"good"'));

  // Review card 2 with again
  r = await call("vega_review", {
    id: card2Id,
    rating: "again",
    date: "2026-10-11T10:05:00.000Z",
    ms: 6000,
    hub: TEST_DIR,
  });
  ok("vega_review processes again rating", !r.isError && textOf(r).includes("rating 'again'"));

  // 4.11 vega_delete
  r = await call("vega_delete", { id: card3Id, hub: TEST_DIR });
  ok("vega_delete soft-deletes card", !r.isError && textOf(r).includes("soft-deleted"));

  const updatedCollection = JSON.parse(readFileSync(cardsJsonFile, "utf8"));
  ok("cards.json has 3 cards after delete", updatedCollection.cards.length === 3);

  // 4.12 vega_stats
  r = await call("vega_stats", { date: "2026-10-11", hub: TEST_DIR });
  ok(
    "vega_stats calculates stats",
    !r.isError &&
      textOf(r).includes("Reviews Today: 2") &&
      textOf(r).includes("True retention (30 days): n/a") &&
      textOf(r).includes("Learning-step again today: 1"),
  );

  // 4.13 vega_session
  r = await call("vega_session", { date: "2026-10-11", hub: TEST_DIR, build: false });
  ok("vega_session runs successfully", !r.isError && textOf(r).includes("Vega Session Created for 2026-10-11"));

  const sessionDeckFile = join(TEST_DIR, ".vega", "session", "deck.json");
  ok("session/deck.json exists", existsSync(sessionDeckFile));
  const sessionDeck = JSON.parse(readFileSync(sessionDeckFile, "utf8"));
  ok(
    "session deck has title slide with date and subject counts",
    sessionDeck.slides[0].type === "title" && sessionDeck.slides[0].title.includes("2026-10-11"),
  );

  const srsSlide = sessionDeck.slides.find((s) => s.type === "srs");
  ok(
    "session deck has srs slides with card ID and origin",
    Boolean(srsSlide && srsSlide.card && srsSlide.front && srsSlide.back && srsSlide.origin?.label),
    `Card: ${srsSlide?.card}, Origin: ${srsSlide?.origin?.label}`,
  );
  ok("session deck ends with summary slide", sessionDeck.slides[sessionDeck.slides.length - 1].type === "summary");

  // Fixed folder is reused on a second day
  r = await call("vega_session", { date: "2026-10-12", hub: TEST_DIR, build: false });
  const sessionDeckDay2 = JSON.parse(readFileSync(sessionDeckFile, "utf8"));
  ok(
    "fixed session/ folder reused on second day",
    sessionDeckDay2.slides[0].title.includes("2026-10-12"),
  );
  const vegaSubdirs = readdirSync(join(TEST_DIR, ".vega")).filter((f) => f.startsWith("session"));
  ok("only one fixed session folder exists in .vega", vegaSubdirs.length === 1 && vegaSubdirs[0] === "session");

  // 4.13b Formula card in session deck: KaTeX delimiters & HTML render
  const formulaHub = join(TEST_DIR, "formula_session_hub");
  mkdirSync(formulaHub, { recursive: true });
  await vegaLib.addCards(
    [
      {
        subject: "Học máy",
        deck: "02-m2-1-hoi-quy",
        kind: "basic",
        front: "Công thức hồi quy tuyến tính $\\hat{\\mathbf{y}}$",
        back: "$$\\hat{\\mathbf{y}} = X\\mathbf{w} + b$$",
        origin: {
          kind: "aurora-notebook",
          path: splitDeckPath,
          locator: "slide 1 (notebook)",
        },
        tags: ["ml", "formula"],
      },
    ],
    formulaHub,
  );

  await vegaLib.createSessionDeck({ hub: formulaHub, date: "2026-10-11", build: true });
  const fSessionDeckPath = join(formulaHub, ".vega", "session", "deck.json");
  const fSessionDeck = JSON.parse(readFileSync(fSessionDeckPath, "utf8"));
  const fSlide = fSessionDeck.slides.find((s) => s.type === "srs" && s.back?.startsWith("$$"));
  ok(
    "session deck.json back keeps the $$ delimiters",
    Boolean(fSlide && fSlide.back === "$$\\hat{\\mathbf{y}} = X\\mathbf{w} + b$$"),
    fSlide?.back,
  );

  const fSessionHtmlPath = join(formulaHub, ".vega", "session", "index.html");
  if (existsSync(fSessionHtmlPath)) {
    const htmlContent = readFileSync(fSessionHtmlPath, "utf8");
    ok(
      "built session HTML contains KaTeX output (class katex)",
      htmlContent.includes('class="katex"') || htmlContent.includes("katex"),
    );
  }

  // 4.14 vega_sync
  const fixtureLines = [
    JSON.stringify({ v: 1, t: "2026-10-11T12:00:00.000Z", course: null, lesson: "session", deck: "Ôn tập", slide: 2, type: "card", card: card1Id, rating: "good", ms: 3000 }),
    JSON.stringify({ v: 1, t: "2026-10-11T12:05:00.000Z", course: null, lesson: "session", deck: "Ôn tập", slide: 3, type: "card", card: card2Id, rating: "again", ms: 4000 }),
    JSON.stringify({ v: 1, t: "2026-10-11T12:10:00.000Z", course: null, lesson: "session", deck: "Ôn tập", slide: 4, type: "card", card: card1Id, rating: "easy", ms: 2000 }),
    JSON.stringify({ v: 1, t: "2026-10-11T12:15:00.000Z", course: null, lesson: "session", deck: "Ôn tập", slide: 5, type: "card", card: "c_unknown_99999", rating: "good" }),
    `{"v":1, "bad json line`,
    JSON.stringify({ v: 1, t: "2026-10-11T12:20:00.000Z", type: "quiz", score: 1 }),
  ];
  writeFileSync(fixtureProgressFile, fixtureLines.join("\n"), "utf8");

  // Offline ts-fsrs calculation for comparison
  const collBeforeSync = JSON.parse(readFileSync(cardsJsonFile, "utf8"));
  const card1Before = collBeforeSync.cards.find((c) => c.id === card1Id);
  const card2Before = collBeforeSync.cards.find((c) => c.id === card2Id);

  const expStep1 = vegaLib.stepFsrs(card1Before.fsrs, "good", new Date("2026-10-11T12:00:00.000Z"));
  const expStep2 = vegaLib.stepFsrs(card2Before.fsrs, "again", new Date("2026-10-11T12:05:00.000Z"));
  const expStep3 = vegaLib.stepFsrs(expStep1.nextState, "easy", new Date("2026-10-11T12:10:00.000Z"));

  r = await call("vega_sync", { file: fixtureProgressFile, hub: TEST_DIR });
  ok(
    "vega_sync applies fixture progress events",
    !r.isError && textOf(r).includes("Reviews applied: 3") && textOf(r).includes("Learning-step again: 1"),
  );
  ok(
    "vega_sync skips unknown card and malformed line",
    textOf(r).includes("c_unknown_99999") && textOf(r).includes("Malformed lines skipped: 1"),
  );
  ok(
    "vega_sync reply carries the inbox counts first (empty inbox: all zero)",
    textOf(r).includes("Hộp thư thẻ: đọc 0 tệp · tạo 0 thẻ · trùng 0 · từ chối 0") &&
      textOf(r).indexOf("Hộp thư thẻ:") < textOf(r).indexOf("Reviews applied:"),
  );

  const collAfterSync = JSON.parse(readFileSync(cardsJsonFile, "utf8"));
  const card1After = collAfterSync.cards.find((c) => c.id === card1Id);
  const card2After = collAfterSync.cards.find((c) => c.id === card2Id);

  ok(
    "card 1 state matches ts-fsrs step progression",
    card1After.fsrs.state === expStep3.nextState.state &&
      card1After.fsrs.reps === expStep3.nextState.reps &&
      card1After.fsrs.stability === expStep3.nextState.stability,
    `Card 1 stability: ${card1After.fsrs.stability}, expected: ${expStep3.nextState.stability}`,
  );
  ok(
    "card 2 state matches ts-fsrs step progression",
    card2After.fsrs.state === expStep2.nextState.state &&
      card2After.fsrs.lapses === expStep2.nextState.lapses,
    `Card 2 lapses: ${card2After.fsrs.lapses}, state: ${card2After.fsrs.state}`,
  );

  const syncStateFile = join(TEST_DIR, ".vega", "sync-state.json");
  ok("sync-state.json exists with processed hashes", existsSync(syncStateFile));

  // Test sync idempotency
  r = await call("vega_sync", { file: fixtureProgressFile, hub: TEST_DIR });
  ok(
    "vega_sync is idempotent on rerun",
    !r.isError && textOf(r).includes("Reviews applied: 0") && textOf(r).includes("Skipped (already synced): 4"),
  );

  const collAfterRerun = JSON.parse(readFileSync(cardsJsonFile, "utf8"));
  const card1AfterRerun = collAfterRerun.cards.find((c) => c.id === card1Id);
  ok(
    "card 1 state is unchanged on rerun",
    card1AfterRerun.fsrs.reps === card1After.fsrs.reps &&
      card1AfterRerun.fsrs.stability === card1After.fsrs.stability,
  );

  // 4.15 Atomic writes check: no temporary files left in .vega
  const vegaDirFiles = readdirSync(join(TEST_DIR, ".vega"));
  const tmpFiles = vegaDirFiles.filter((f) => f.includes(".tmp."));
  ok("atomic writes clean up temporary files", tmpFiles.length === 0, `files in .vega: ${vegaDirFiles.join(", ")}`);
  ok(
    "vega_sync does not create the inbox folder when no producer has sent anything",
    !existsSync(join(TEST_DIR, ".vega", "inbox")),
  );

  // 4.16 FSRS True Retention & Legacy Log Support (v0.2.1)
  console.log("\n--- Testing FSRS True Retention & Legacy Logs (v0.2.1) ---");
  const retentionTestDir = join(TEST_DIR, "retention_spec5");
  mkdirSync(join(retentionTestDir, ".vega"), { recursive: true });

  const fixtureLogLines = [
    // 1. New card rated again then good (learning steps, not in Review state)
    JSON.stringify({ t: "2026-10-11T09:00:00.000Z", card: "c_new_card", rating: "again", state_before: 0, due_before: "2026-10-11T09:00:00.000Z", elapsed_days: 0, via: "tool" }),
    JSON.stringify({ t: "2026-10-11T09:10:00.000Z", card: "c_new_card", rating: "good", state_before: 1, due_before: "2026-10-11T09:10:00.000Z", elapsed_days: 0, via: "tool" }),
    // 2. Review-state card rated good (passed review)
    JSON.stringify({ t: "2026-10-11T09:20:00.000Z", card: "c_rev_good", rating: "good", state_before: 2, due_before: "2026-10-11T09:20:00.000Z", elapsed_days: 3, via: "tool" }),
    // 3. Another review-state card rated again (failed review / lapse)
    JSON.stringify({ t: "2026-10-11T09:30:00.000Z", card: "c_rev_again", rating: "again", state_before: 2, due_before: "2026-10-11T09:30:00.000Z", elapsed_days: 5, via: "tool" }),
    // 4. Old lines without stored state_before, due_before, or elapsed_days
    JSON.stringify({ t: "2026-10-11T09:40:00.000Z", card: "c_legacy_card", rating: "good" }),
  ];
  writeFileSync(join(retentionTestDir, ".vega", "reviews.jsonl"), fixtureLogLines.join("\n") + "\n", "utf8");

  // Call vega_stats for retentionTestDir
  r = await call("vega_stats", { date: "2026-10-11", hub: retentionTestDir });
  ok("vega_stats returns true retention 50% (1/2)", !r.isError && textOf(r).includes("True retention (30 days): 50% (1/2)"), textOf(r));
  ok("vega_stats reports learning agains 1", !r.isError && textOf(r).includes("Learning-step again today: 1"), textOf(r));

  // Verify that old lines without stored state still load into review logs
  const loadedLogs = await vegaLib.readReviewLogs(retentionTestDir);
  const legacyEntry = loadedLogs.find((l) => l.card === "c_legacy_card");
  ok("old lines without stored state still load", Boolean(legacyEntry && legacyEntry.rating === "good"), `Loaded ${loadedLogs.length} logs`);

  // Verify vega_stats when there are no review-state cards (shows "n/a")
  const noReviewHub = join(TEST_DIR, "no_review_hub");
  mkdirSync(join(noReviewHub, ".vega"), { recursive: true });
  writeFileSync(
    join(noReviewHub, ".vega", "reviews.jsonl"),
    JSON.stringify({ t: "2026-10-11T09:00:00.000Z", card: "c_new_1", rating: "again", state_before: 0, due_before: "2026-10-11T09:00:00.000Z", elapsed_days: 0, via: "tool" }) + "\n",
    "utf8",
  );
  r = await call("vega_stats", { date: "2026-10-11", hub: noReviewHub });
  ok("vega_stats shows n/a when no review-state reviews exist", !r.isError && textOf(r).includes("True retention (30 days): n/a"), textOf(r));

  /* ───────── 4.17 Card inbox (contract vega-card-inbox.v1, v0.3.0) ───────── */

  console.log("\n--- Card Inbox: the single review queue (v0.3.0) ---");

  const inboxHub = join(TEST_DIR, "inbox_hub");
  mkdirSync(inboxHub, { recursive: true });
  const inboxDir = inboxDirOf(inboxHub);
  const inboxCardsFile = join(inboxHub, ".vega", "cards.json");
  const inboxReviewsFile = join(inboxHub, ".vega", "reviews.jsonl");
  const doneDir = join(inboxDir, "done");
  const rejectedDir = join(inboxDir, "rejected");

  // The unkeyed delete of section 4.11 keeps the old log line (no key field)
  const plainDeletedLine = readJsonl(reviewsJsonlFile).find((l) => l.rating === "deleted");
  ok(
    "deleting a card without a key writes the unchanged log line (no key field)",
    Boolean(plainDeletedLine) && !("key" in plainDeletedLine),
  );

  // Seed: a suspended keyed card, a keyed card that gets soft-deleted, and one card without a key.
  r = await call("vega_add", {
    hub: inboxHub,
    cards: [
      {
        subject: "Python_Basics",
        front: "Thẻ tạm dừng có khóa",
        back: "Đã tạm dừng.",
        key: "orion:Lab_1:check_suspended",
        origin: { kind: "orion-attempt", path: "Lab_1/lab.json", locator: "check_suspended" },
        created: "2026-10-12T00:00:00.000Z",
      },
      {
        subject: "Python_Basics",
        front: "Thẻ xóa mềm có khóa",
        back: "Sẽ bị xóa mềm.",
        key: "mira:vong-lap-for:stop-9",
        origin: {
          kind: "mira-stop",
          path: "Python_Basics/mira/vong-lap-for.html",
          locator: "stop-9",
          href: stopHref("vong-lap-for", 9),
        },
        created: "2026-10-12T00:01:00.000Z",
      },
      {
        subject: "Python_Basics",
        front: "Thẻ cũ không có khóa",
        back: "Thẻ thủ công.",
        origin: { kind: "manual", path: "Python_Basics/ghi-chu.md" },
        created: "2026-10-12T00:02:00.000Z",
      },
    ],
  });
  ok("vega_add accepts a card key, origin.href and the new origin kinds", !r.isError && textOf(r).includes("Added 3 card(s)"), textOf(r).split("\n")[0]);

  const seededCards = readCards(inboxHub);
  const susCard = seededCards.find((c) => c.key === "orion:Lab_1:check_suspended");
  const delCard = seededCards.find((c) => c.key === "mira:vong-lap-for:stop-9");
  const plainCard = seededCards.find((c) => !c.key);
  ok(
    "keyed cards keep key and origin.href in cards.json; the card without a key has neither",
    Boolean(susCard && delCard && plainCard) &&
      delCard.origin.href === stopHref("vong-lap-for", 9) &&
      !("key" in plainCard) &&
      !("href" in plainCard.origin),
  );

  r = await call("vega_suspend", { id: susCard.id, suspended: true, hub: inboxHub });
  ok("seed card suspended", !r.isError && textOf(r).includes("SUSPENDED"));
  r = await call("vega_delete", { id: delCard.id, hub: inboxHub });
  ok("seed card soft-deleted", !r.isError && textOf(r).includes("soft-deleted"));
  const deletedLine = readJsonl(inboxReviewsFile).find((l) => l.card === delCard.id && l.rating === "deleted");
  ok(
    "vega_delete writes the card key on the deleted review-log line",
    deletedLine?.key === "mira:vong-lap-for:stop-9",
    JSON.stringify(deletedLine),
  );

  r = await call("vega_add", {
    hub: inboxHub,
    cards: [
      {
        subject: "Python_Basics",
        front: "Mặt trước khác 1",
        back: "x",
        key: "orion:Lab_1:check_suspended",
        origin: { kind: "orion-attempt", path: "Lab_1/other.json" },
      },
      {
        subject: "Python_Basics",
        front: "Mặt trước khác 2",
        back: "x",
        key: "mira:vong-lap-for:stop-9",
        origin: { kind: "mira-stop", path: "Python_Basics/mira/other.html" },
      },
    ],
  });
  ok(
    "vega_add skips a card whose key belongs to a suspended or to a soft-deleted card",
    !r.isError && textOf(r).includes("Added 0 card(s)") && textOf(r).includes("Skipped 2 duplicate(s)"),
    textOf(r).split("\n")[0],
  );

  // Producer batches. Written in reverse name order on purpose: Vega must process by name.
  const NAME_M1 = "mira-20261012T080000-a1b2c3.jsonl";
  const NAME_MA = "mira-20261012T120000-aaaaaa.jsonl";
  const NAME_MB = "mira-20261012T120000-bbbbbb.jsonl";
  const NAME_O = "orion-20261012T100000-0a1b2c.jsonl";
  const NAME_P = "polaris-20261012T090000-d4e5f6.jsonl";
  const NAME_TMP = "mira-20261012T130000-ffffff.jsonl.tmp";

  writeInboxFile(inboxHub, NAME_MB, [miraStop(5, { front: "B: bản đến sau theo thứ tự tên tệp" })]);

  const polarisErrorLine = {
    v: 1,
    t: "2026-10-12T09:00:00+07:00",
    producer: "polaris",
    key: "polaris:Python_Basics:ERR_2026-10-12_ab12cd",
    subject: "Python_Basics",
    deck: "M1",
    front: "Hàm `tong_chu_so(-4567)` trả về sai: giá trị âm cần xử lý ở bước nào trước vòng lặp?",
    back: "Lấy giá trị tuyệt đối trước khi lặp. Quy tắc: chuẩn hóa dữ liệu vào trước.",
    origin: {
      kind: "polaris-errorlog",
      path: "Python_Basics/polaris/errorlog.md",
      locator: "ERR_2026-10-12_ab12cd",
      href: "file:///C:/fixtures/errorlog.md#ERR_2026-10-12_ab12cd",
    },
    tags: ["polaris", "errorlog"],
    reason: "Dự đoán sai trong bài tập M1",
  };
  const polarisSelfLine = {
    v: 1,
    t: "2026-10-12T09:05:00+07:00",
    producer: "polaris",
    key: "polaris:Python_Basics:selfcheck:M1:2",
    subject: "Python_Basics",
    kind: "cloze",
    front: "Vòng lặp [[for]] duyệt qua từng phần tử của một dãy.",
    back: "for",
    origin: { kind: "polaris-selfcheck", path: "Python_Basics/polaris/lessons/m1.outline.md" },
  };
  // UTF-8 BOM and CRLF line endings must be read like any other file
  mkdirSync(inboxDir, { recursive: true });
  writeFileSync(
    join(inboxDir, NAME_P),
    "\uFEFF" + [polarisErrorLine, polarisSelfLine].map((l) => JSON.stringify(l)).join("\r\n") + "\r\n",
    "utf8",
  );

  const orionLine = (over = {}) => ({
    v: 1,
    t: "2026-10-12T10:00:00+07:00",
    producer: "orion",
    key: "orion:Lab_1:check_sum",
    subject: "Python_Basics",
    deck: "Lab_1",
    front: "Phép kiểm tra `check_sum` thất bại 3 lần: điều kiện biên nào bị bỏ sót?",
    back: "Mảng rỗng: tổng phải bằng 0.",
    origin: {
      kind: "orion-attempt",
      path: "Lab_1/lab.json",
      locator: "check_sum",
      href: "file:///C:/fixtures/lab1-report.html#check_sum",
    },
    tags: ["orion", "lab"],
    ...over,
  });
  const orionNoFront = orionLine({ key: "orion:Lab_1:c2" });
  delete orionNoFront.front;
  writeInboxFile(inboxHub, NAME_O, [
    orionLine(), // 1 created
    orionLine({ key: "orion:Lab_1:check_suspended" }), // 2 duplicate of the suspended card
    "đây không phải JSON", // 3 rejected: not JSON
    orionLine({ key: "orion:Lab_1:c1", extra: "x" }), // 4 rejected: unknown field
    orionNoFront, // 5 rejected: front missing
    orionLine({ key: "orion:Lab_1:c3", front: "x".repeat(601) }), // 6 rejected: front too long
    orionLine({ key: "mira:Lab_1:c4" }), // 7 rejected: key prefix does not match the producer
    orionLine({ key: "orion:Lab_1:c5", t: "2026-02-30T10:00:00Z" }), // 8 rejected: impossible date
    orionLine({ key: "orion:Lab_1:c6", v: 2 }), // 9 rejected: v
    orionLine({ key: "orion:Lab_1:c7", origin: { kind: "aurora-notebook", path: "x" } }), // 10 rejected: origin kind
  ]);

  writeInboxFile(inboxHub, NAME_MA, [miraStop(5, { front: "A: bản đến trước theo thứ tự tên tệp" })]);

  const minimalMiraLine = {
    v: 1,
    t: "2026-10-12T08:10:00Z",
    producer: "mira",
    key: "mira:vong-lap-for:stop-3",
    subject: "Python_Basics",
    front: "Điểm dừng 3 chỉ có các trường bắt buộc: `i` bằng bao nhiêu?",
    back: "",
    origin: { kind: "mira-stop", path: "Python_Basics/mira/vong-lap-for.html" },
  };
  writeInboxFile(inboxHub, NAME_M1, [
    miraStop(1), // created
    miraStop(2), // created
    minimalMiraLine, // created, only required fields
    miraStop(9), // duplicate of the soft-deleted card
    miraStop(4, { extra: "x" }), // rejected: unknown field
  ]);

  // Not inbox files: a producer still writing (.tmp), a stray file, and a subfolder
  writeInboxFile(inboxHub, NAME_TMP, [miraStop(11)]);
  const tmpPath = join(inboxDir, NAME_TMP);
  const tmpBytes = readFileSync(tmpPath);
  writeFileSync(join(inboxDir, "notes.txt"), "ghi chú của producer, không phải thẻ\n", "utf8");
  mkdirSync(join(inboxDir, "sub"), { recursive: true });
  writeFileSync(join(inboxDir, "sub", "mira-20261012T090000-111111.jsonl"), toJsonl([miraStop(20)]), "utf8");

  // vega_inbox list: preview, no writes
  const cardsBytesBeforeList = readFileSync(inboxCardsFile);
  const treeBeforeList = treeSnapshot(join(inboxHub, ".vega"));
  r = await call("vega_inbox", { action: "list", hub: inboxHub });
  const listText = textOf(r);
  ok(
    "vega_inbox list previews the pending files with line counts and the would-be result",
    !r.isError &&
      listText.includes("chỉ đọc, không ghi gì") &&
      listText.includes("Tệp đang chờ: 5 (19 dòng)") &&
      listText.includes("tạo 7 thẻ mới · bỏ qua 3 dòng trùng khóa · từ chối 9 dòng") &&
      listText.includes(`${NAME_O}: 10 dòng · sẽ tạo 1 · trùng 1 · sẽ từ chối 8`) &&
      listText.includes(`${NAME_P}: 2 dòng · sẽ tạo 2 · trùng 0 · sẽ từ chối 0`),
    listText.split("\n").slice(0, 4).join(" | "),
  );
  ok(
    "vega_inbox list shows the validation reasons and ignores .tmp, stray files and subfolders",
    listText.includes('dòng 4: trường lạ không được phép: "extra"') &&
      listText.includes("... và 3 dòng lỗi khác") &&
      listText.includes(NAME_TMP) &&
      listText.includes("notes.txt") &&
      !listText.includes("mira-20261012T090000-111111.jsonl"),
  );
  ok(
    "vega_inbox list makes no writes (tree snapshot identical, cards.json bytes equal, no done/ or rejected/)",
    treeSnapshot(join(inboxHub, ".vega")) === treeBeforeList &&
      Buffer.compare(readFileSync(inboxCardsFile), cardsBytesBeforeList) === 0 &&
      !existsSync(doneDir) &&
      !existsSync(rejectedDir),
  );

  // vega_inbox ingest
  r = await call("vega_inbox", { action: "ingest", hub: inboxHub });
  const ingestText = textOf(r);
  ok(
    "vega_inbox ingest reports files read, cards created, duplicates and rejected lines",
    !r.isError &&
      ingestText.includes("Tệp đã đọc: 5 (19 dòng)") &&
      ingestText.includes("Thẻ mới tạo: 7") &&
      ingestText.includes("Trùng khóa (bỏ qua): 3") &&
      ingestText.includes("Dòng bị từ chối: 9"),
    ingestText.split("\n").slice(0, 6).join(" | "),
  );
  ok(
    "ingest processes files in name order",
    [NAME_M1, NAME_MA, NAME_MB, NAME_O, NAME_P].every((n, i, all) => i === 0 || ingestText.indexOf(all[i - 1]) < ingestText.indexOf(n)) &&
      ingestText.includes(`-> done/${NAME_O}; dòng lỗi: rejected/${NAME_O}`),
  );

  const ingested = readCards(inboxHub);
  const byKey = (k) => ingested.filter((c) => c.key === k);
  const stop1 = byKey("mira:vong-lap-for:stop-1")[0];
  ok(
    "a valid line becomes a New FSRS card with key, origin.href, created = t and its fields",
    Boolean(stop1) &&
      stop1.fsrs.state === 0 &&
      stop1.fsrs.reps === 0 &&
      stop1.created === new Date("2026-10-12T08:01:00+07:00").toISOString() &&
      stop1.origin.kind === "mira-stop" &&
      stop1.origin.locator === "stop-1" &&
      stop1.origin.href === stopHref("vong-lap-for", 1) &&
      stop1.subject === "Python_Basics" &&
      stop1.deck === "Vòng lặp for" &&
      stop1.kind === "basic" &&
      isDeepStrictEqual(stop1.tags, ["python"]) &&
      !("reason" in stop1),
    JSON.stringify(stop1?.origin),
  );
  const stop3 = byKey("mira:vong-lap-for:stop-3")[0];
  ok(
    "a line with only the required fields creates a clean card (no deck, hint, hook, locator, href)",
    Boolean(stop3) &&
      stop3.back === "" &&
      stop3.kind === "basic" &&
      stop3.tags.length === 0 &&
      stop3.created === "2026-10-12T08:10:00.000Z" &&
      !("deck" in stop3) &&
      !("hint" in stop3) &&
      !("hook" in stop3) &&
      !("locator" in stop3.origin) &&
      !("href" in stop3.origin),
  );
  const errCard = byKey("polaris:Python_Basics:ERR_2026-10-12_ab12cd")[0];
  const selfCard = byKey("polaris:Python_Basics:selfcheck:M1:2")[0];
  const orionCard = byKey("orion:Lab_1:check_sum")[0];
  ok(
    "BOM + CRLF file read; error-log, self-check (cloze) and Orion cards created with their origins",
    Boolean(errCard && selfCard && orionCard) &&
      errCard.origin.kind === "polaris-errorlog" &&
      errCard.origin.href === "file:///C:/fixtures/errorlog.md#ERR_2026-10-12_ab12cd" &&
      selfCard.kind === "cloze" &&
      selfCard.origin.kind === "polaris-selfcheck" &&
      selfCard.front.includes("[[for]]") &&
      orionCard.origin.kind === "orion-attempt" &&
      orionCard.origin.locator === "check_sum",
  );
  ok(
    "duplicate key skipped against a suspended card (still exactly one card, still suspended)",
    byKey("orion:Lab_1:check_suspended").length === 1 && byKey("orion:Lab_1:check_suspended")[0].suspended === true,
  );
  ok("duplicate key skipped against a soft-deleted card (it is not re-created)", byKey("mira:vong-lap-for:stop-9").length === 0);
  ok(
    "the first file in name order wins a key shared by two files",
    byKey("mira:vong-lap-for:stop-5").length === 1 && byKey("mira:vong-lap-for:stop-5")[0].front.startsWith("A:"),
  );
  ok(
    "cards.json = 2 existing + 7 created, every card key unique, and the file is still valid for the other tools",
    ingested.length === 9 &&
      new Set(ingested.filter((c) => c.key).map((c) => c.key)).size === ingested.filter((c) => c.key).length,
    `${ingested.length} cards`,
  );
  r = await call("vega_review", { id: stop1.id, rating: "good", date: "2026-10-12T10:00:00.000Z", hub: inboxHub });
  ok("an ingested card reviews like any other (New -> Learning)", !r.isError && textOf(r).includes("New -> Learning"), textOf(r).split("\n")[1]);

  // Files: done/, rejected/, untouched non-inbox files
  const doneNames = readdirSync(doneDir).sort();
  ok(
    "processed files are moved to done/ and gone from the inbox",
    isDeepStrictEqual(doneNames, [NAME_M1, NAME_MA, NAME_MB, NAME_O, NAME_P].sort()) &&
      [NAME_M1, NAME_MA, NAME_MB, NAME_O, NAME_P].every((n) => !existsSync(join(inboxDir, n))),
    doneNames.join(", "),
  );
  ok(
    "done/ keeps the producer's file byte for byte",
    Buffer.compare(readFileSync(join(doneDir, NAME_P)), Buffer.concat([Buffer.from("\uFEFF", "utf8"), Buffer.from([polarisErrorLine, polarisSelfLine].map((l) => JSON.stringify(l)).join("\r\n") + "\r\n", "utf8")])) === 0,
  );
  const rejectedNames = readdirSync(rejectedDir).sort();
  ok(
    "rejected/ holds only the files that had invalid lines, under the same name",
    isDeepStrictEqual(rejectedNames, [NAME_M1, NAME_O].sort()),
    rejectedNames.join(", "),
  );
  const rejectedOrion = readJsonl(join(rejectedDir, NAME_O));
  const rejectedReasons = rejectedOrion.map((l) => l._error).join("\n");
  ok(
    "rejected/ <orion file>: all 8 invalid lines, each with an _error that names the line and the reason",
    rejectedOrion.length === 8 &&
      rejectedOrion.every((l) => typeof l._error === "string" && /^dòng \d+: /.test(l._error)) &&
      rejectedReasons.includes("dòng 3: JSON không hợp lệ") &&
      rejectedReasons.includes('trường lạ không được phép: "extra"') &&
      rejectedReasons.includes('thiếu trường bắt buộc "front"') &&
      rejectedReasons.includes("quá dài (601 ký tự, tối đa 600)") &&
      rejectedReasons.includes('"key" phải bắt đầu bằng "orion:"') &&
      rejectedReasons.includes('"t" phải là thời điểm ISO 8601') &&
      rejectedReasons.includes('"v" phải là số nguyên 1') &&
      rejectedReasons.includes('"origin.kind" phải là một trong'),
    rejectedReasons.split("\n").map((l) => l.slice(0, 40)).join(" | "),
  );
  ok("a line that is not JSON is kept as _raw", rejectedOrion[0]?._raw === "đây không phải JSON");
  const rejectedMira = readJsonl(join(rejectedDir, NAME_M1));
  ok(
    "an unknown field is rejected: the original line is kept and gets _error",
    rejectedMira.length === 1 &&
      rejectedMira[0].extra === "x" &&
      rejectedMira[0].key === "mira:vong-lap-for:stop-4" &&
      rejectedMira[0]._error === 'dòng 5: trường lạ không được phép: "extra"',
    JSON.stringify(rejectedMira[0]?._error),
  );
  ok(
    "no card was created for any rejected line",
    byKey("mira:vong-lap-for:stop-4").length === 0 && ingested.every((c) => !/^orion:Lab_1:c\d$/.test(c.key ?? "")),
  );
  ok(
    ".tmp file, stray file and subfolder are left untouched",
    isDeepStrictEqual(readdirSync(inboxDir).sort(), ["done", NAME_TMP, "notes.txt", "rejected", "sub"].sort()) &&
      Buffer.compare(readFileSync(tmpPath), tmpBytes) === 0 &&
      existsSync(join(inboxDir, "sub", "mira-20261012T090000-111111.jsonl")),
  );
  ok(
    "atomic writes leave no temporary files in inbox/rejected or .vega",
    readdirSync(rejectedDir).every((f) => !f.includes(".tmp.")) &&
      readdirSync(join(inboxHub, ".vega")).every((f) => !f.includes(".tmp.")),
  );

  // Second ingest is a no-op
  const treeAfterIngest = treeSnapshot(join(inboxHub, ".vega"));
  r = await call("vega_inbox", { action: "ingest", hub: inboxHub });
  ok(
    "a second ingest is a no-op (empty inbox, nothing created, nothing rewritten)",
    !r.isError && textOf(r).includes("Hộp thư trống") && treeSnapshot(join(inboxHub, ".vega")) === treeAfterIngest,
    textOf(r).split("\n")[1],
  );

  // The same lines sent again from a new file are duplicates, not new cards
  writeInboxFile(inboxHub, "mira-20261012T131500-abcdef.jsonl", [miraStop(1), miraStop(2), minimalMiraLine]);
  r = await call("vega_inbox", { action: "ingest", hub: inboxHub });
  ok(
    "re-sending already ingested lines in a new file creates no card (3 duplicates)",
    textOf(r).includes("Thẻ mới tạo: 0") && textOf(r).includes("Trùng khóa (bỏ qua): 3") && readCards(inboxHub).length === 9,
  );

  // A producer renames its .tmp file to .jsonl: now it is picked up
  renameSync(tmpPath, join(inboxDir, NAME_TMP.replace(/\.tmp$/, "")));
  r = await call("vega_inbox", { action: "ingest", hub: inboxHub });
  ok(
    "a .tmp file is ignored while being written and ingested once renamed to .jsonl",
    textOf(r).includes("Tệp đã đọc: 1 (1 dòng)") &&
      textOf(r).includes("Thẻ mới tạo: 1") &&
      readCards(inboxHub).some((c) => c.key === "mira:vong-lap-for:stop-11") &&
      existsSync(join(doneDir, NAME_TMP.replace(/\.tmp$/, ""))),
  );

  // An inbox card the learner deletes is never re-created
  const stop2 = readCards(inboxHub).find((c) => c.key === "mira:vong-lap-for:stop-2");
  r = await call("vega_delete", { id: stop2.id, hub: inboxHub });
  ok(
    "deleting an ingested card stores its key in the log",
    !r.isError && readJsonl(inboxReviewsFile).some((l) => l.card === stop2.id && l.rating === "deleted" && l.key === "mira:vong-lap-for:stop-2"),
  );
  writeInboxFile(inboxHub, "mira-20261012T141500-de1e7e.jsonl", [miraStop(2)]);
  r = await call("vega_inbox", { action: "ingest", hub: inboxHub });
  ok(
    "a producer re-sending a card the learner deleted is a duplicate, not a new card",
    textOf(r).includes("Thẻ mới tạo: 0") &&
      textOf(r).includes("Trùng khóa (bỏ qua): 1") &&
      !readCards(inboxHub).some((c) => c.key === "mira:vong-lap-for:stop-2"),
  );

  // vega_due: ingested New cards come in the new-card limit, oldest created first
  const newPool = readCards(inboxHub)
    .filter((c) => c.fsrs.state === 0 && !c.suspended)
    .sort((a, b) => a.created.localeCompare(b.created));
  r = await call("vega_due", { date: "2026-10-12", new_limit: 3, hub: inboxHub });
  const dueInboxText = textOf(r);
  const dueIdx = newPool.slice(0, 3).map((c) => dueInboxText.indexOf(c.id));
  // The queue also holds the one card reviewed above (Learning, due today), so: 1 due + 3 new.
  ok(
    "vega_due shows ingested New cards within the new-card limit (3 of the pool, oldest created first)",
    !r.isError &&
      dueInboxText.includes("Total in queue: 4 (0 overdue, 1 due today, 3 new)") &&
      dueInboxText.includes(`Remaining new cards available: ${newPool.length - 3}`) &&
      dueInboxText.includes(stop1.id) &&
      dueIdx.every((i) => i >= 0) &&
      dueIdx[0] < dueIdx[1] &&
      dueIdx[1] < dueIdx[2] &&
      !dueInboxText.includes(newPool[3].id) &&
      !dueInboxText.includes(susCard.id),
    `pool ${newPool.length}; ${dueInboxText.split("\n")[1]}`,
  );
  r = await call("vega_due", { date: "2026-10-12", hub: inboxHub });
  ok(
    "vega_due with the default limit shows all ingested New cards while they fit the 10 new cards per day",
    newPool.length <= 10 &&
      textOf(r).includes(`Total in queue: ${1 + newPool.length} (0 overdue, 1 due today, ${newPool.length} new)`) &&
      newPool.every((c) => textOf(r).includes(c.id)),
    textOf(r).split("\n")[1],
  );

  // vega_sync ingests the inbox first and reports the counts
  writeInboxFile(inboxHub, "mira-20261012T150000-c0ffee.jsonl", [
    miraStop(6),
    miraStop(7),
    miraStop(8, { front: "" }), // rejected: empty front
  ]);
  const cardCountBeforeSync = readCards(inboxHub).length;
  r = await call("vega_sync", { hub: inboxHub });
  const syncInboxText = textOf(r);
  ok(
    "vega_sync ingests the inbox first and reports its counts together with the sync result",
    !r.isError &&
      syncInboxText.includes("Hộp thư thẻ: đọc 1 tệp · tạo 2 thẻ · trùng 0 · từ chối 1") &&
      syncInboxText.includes('mira-20261012T150000-c0ffee.jsonl dòng 3: "front" không được rỗng') &&
      syncInboxText.includes("Reviews applied: 0") &&
      syncInboxText.indexOf("Hộp thư thẻ:") < syncInboxText.indexOf("Reviews applied:"),
    syncInboxText.split("\n").slice(0, 3).join(" | "),
  );
  ok(
    "vega_sync created the 2 cards and archived the file",
    readCards(inboxHub).length === cardCountBeforeSync + 2 &&
      existsSync(join(doneDir, "mira-20261012T150000-c0ffee.jsonl")) &&
      existsSync(join(rejectedDir, "mira-20261012T150000-c0ffee.jsonl")),
  );
  r = await call("vega_sync", { hub: inboxHub });
  ok(
    "vega_sync with an empty inbox still reports the zero counts",
    textOf(r).includes("Hộp thư thẻ: đọc 0 tệp · tạo 0 thẻ · trùng 0 · từ chối 0"),
  );

  // Session deck: origin label and href
  r = await call("vega_session", { date: "2026-10-12", hub: inboxHub, build: false, new_limit: 50 });
  ok("vega_session runs on a collection that contains inbox cards", !r.isError && textOf(r).includes("Vega Session Created for 2026-10-12"));
  const inboxDeck = JSON.parse(readFileSync(join(inboxHub, ".vega", "session", "deck.json"), "utf8"));
  const slideOfKey = (k) => {
    const card = readCards(inboxHub).find((c) => c.key === k);
    return inboxDeck.slides.find((s) => s.type === "srs" && s.card === card?.id);
  };
  const miraSlide = slideOfKey("mira:vong-lap-for:stop-1");
  ok(
    "session srs slide of a Mira card carries origin {label, href} = 'Mira · điểm dừng 1' and the producer's href",
    miraSlide?.origin?.label === "Mira · điểm dừng 1" && miraSlide?.origin?.href === stopHref("vong-lap-for", 1),
    JSON.stringify(miraSlide?.origin),
  );
  const errSlide = slideOfKey("polaris:Python_Basics:ERR_2026-10-12_ab12cd");
  ok(
    "session srs slide of an error-log card: label 'Sổ lỗi · ERR_2026-10-12_ab12cd' with href",
    errSlide?.origin?.label === "Sổ lỗi · ERR_2026-10-12_ab12cd" &&
      errSlide?.origin?.href === "file:///C:/fixtures/errorlog.md#ERR_2026-10-12_ab12cd",
    JSON.stringify(errSlide?.origin),
  );
  const orionSlide = slideOfKey("orion:Lab_1:check_sum");
  ok(
    "session srs slide of an Orion card: label 'Orion · check_sum' with href",
    orionSlide?.origin?.label === "Orion · check_sum" &&
      orionSlide?.origin?.href === "file:///C:/fixtures/lab1-report.html#check_sum",
    JSON.stringify(orionSlide?.origin),
  );
  const selfSlide = slideOfKey("polaris:Python_Basics:selfcheck:M1:2");
  ok(
    "a card without origin.href keeps the previous origin behaviour (label, no href)",
    Boolean(selfSlide?.origin?.label) && selfSlide.origin.href === undefined,
    JSON.stringify(selfSlide?.origin),
  );

  // describeOrigin: labels from kind + locator (falling back to the key tail)
  const describe = vegaLib.describeOrigin;
  ok(
    "describeOrigin builds short Vietnamese labels from origin kind + locator",
    describe({ origin: { kind: "mira-stop", path: "p", locator: "stop-3" } }) === "Mira · điểm dừng 3" &&
      describe({ origin: { kind: "mira-stop", path: "p", locator: "#stop-3" } }) === "Mira · điểm dừng 3" &&
      describe({ origin: { kind: "mira-stop", path: "p", locator: "Điểm dừng 3" } }) === "Mira · Điểm dừng 3" &&
      describe({ origin: { kind: "polaris-errorlog", path: "p", locator: "ERR_2026-10-12_ab12cd" } }) === "Sổ lỗi · ERR_2026-10-12_ab12cd" &&
      describe({ origin: { kind: "orion-attempt", path: "p", locator: "check_sum" } }) === "Orion · check_sum" &&
      describe({ origin: { kind: "aurora-predict", path: "p" }, deck: "Vòng lặp for" }) === "Dự đoán · Vòng lặp for" &&
      describe({ origin: { kind: "manual", path: "p" } }) === "Thủ công",
  );
  ok(
    "describeOrigin falls back to the card key tail, and truncates long labels",
    describe({ key: "mira:vong-lap-for:stop-4", origin: { kind: "mira-stop", path: "p" } }) === "Mira · điểm dừng 4" &&
      describe({ key: "polaris:Machine_Learning:ERR_2026-10-12_ab12cd", origin: { kind: "polaris-errorlog", path: "p" } }) === "Sổ lỗi · ERR_2026-10-12_ab12cd" &&
      describe({ key: "orion:Lab_1:check_sum", origin: { kind: "orion-attempt", path: "p" } }) === "Orion · check_sum" &&
      describe({ key: "polaris:ML:selfcheck:M2:3", origin: { kind: "polaris-selfcheck", path: "p" } }) === "Tự kiểm tra · M2 · mục 3" &&
      describe({ origin: { kind: "orion-attempt", path: "p", locator: "x".repeat(200) } }).length === 80,
  );

  // File-name collisions: an earlier archived file is never overwritten
  const doneOriginal = readFileSync(join(doneDir, NAME_M1));
  writeInboxFile(inboxHub, NAME_M1, [miraStop(12)]);
  r = await call("vega_inbox", { action: "ingest", hub: inboxHub });
  const nameM1Second = NAME_M1.replace(/\.jsonl$/, ".2.jsonl");
  ok(
    "a producer re-using a file name never overwrites done/: the new file is archived as <name>.2.jsonl",
    textOf(r).includes("Thẻ mới tạo: 1") &&
      existsSync(join(doneDir, nameM1Second)) &&
      Buffer.compare(readFileSync(join(doneDir, NAME_M1)), doneOriginal) === 0,
    textOf(r).split("\n").slice(1, 4).join(" | "),
  );
  copyFileSync(join(doneDir, NAME_M1), join(inboxDir, NAME_M1));
  r = await call("vega_inbox", { action: "ingest", hub: inboxHub });
  ok(
    "re-dropping an identical file is absorbed: no extra copy in done/ or rejected/, inbox emptied",
    textOf(r).includes("Thẻ mới tạo: 0") &&
      !existsSync(join(doneDir, NAME_M1.replace(/\.jsonl$/, ".3.jsonl"))) &&
      !existsSync(join(rejectedDir, NAME_M1.replace(/\.jsonl$/, ".2.jsonl"))) &&
      !existsSync(join(inboxDir, NAME_M1)),
  );

  // Hubs with problems
  const badHub = join(TEST_DIR, "bad_encoding_hub");
  mkdirSync(inboxDirOf(badHub), { recursive: true });
  const badFile = join(inboxDirOf(badHub), "polaris-20261012T160000-badbad.jsonl");
  writeFileSync(badFile, Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d, 0x0a]));
  r = await call("vega_inbox", { action: "ingest", hub: badHub });
  ok(
    "a file that is not valid UTF-8 is reported and left in place (nothing is written)",
    !r.isError &&
      textOf(r).includes("không phải UTF-8 hợp lệ") &&
      existsSync(badFile) &&
      !existsSync(join(badHub, ".vega", "cards.json")),
    textOf(r).split("\n").slice(1, 4).join(" | "),
  );

  const corruptHub = join(TEST_DIR, "corrupt_cards_hub");
  mkdirSync(join(corruptHub, ".vega"), { recursive: true });
  writeFileSync(join(corruptHub, ".vega", "cards.json"), "{ not json", "utf8");
  writeInboxFile(corruptHub, "manual-20261012T170000-0000aa.jsonl", [
    { ...minimalMiraLine, producer: "manual", key: "manual:ghi-chu:1", origin: { kind: "manual", path: "ghi-chu.md" } },
  ]);
  r = await call("vega_inbox", { action: "ingest", hub: corruptHub });
  ok(
    "ingest refuses to overwrite an unparseable cards.json (error result, file and inbox kept)",
    r.isError === true &&
      textOf(r).includes("cards.json không phân tích được") &&
      readFileSync(join(corruptHub, ".vega", "cards.json"), "utf8") === "{ not json" &&
      existsSync(join(inboxDirOf(corruptHub), "manual-20261012T170000-0000aa.jsonl")),
    textOf(r).slice(0, 80),
  );
  r = await call("vega_sync", { hub: corruptHub });
  ok(
    "vega_sync survives an inbox failure: it reports the error and still completes",
    !r.isError && textOf(r).includes("Hộp thư thẻ: lỗi") && textOf(r).includes("Reviews applied: 0"),
    textOf(r).split("\n").slice(0, 2).join(" | "),
  );

  const emptyHub = join(TEST_DIR, "no_inbox_hub");
  mkdirSync(emptyHub, { recursive: true });
  const emptyList = await vegaLib.listInbox(emptyHub);
  const emptyIngest = await vegaLib.ingestInbox(emptyHub);
  ok(
    "a hub without inbox/ is reported as such; list and ingest create nothing",
    emptyList.exists === false &&
      emptyList.pending_files === 0 &&
      emptyList.summary.includes("chưa tồn tại") &&
      emptyIngest.files_read === 0 &&
      readdirSync(emptyHub).length === 0,
  );

  // Backward compatibility: cards.json written before v0.3.0 (no key, no origin.href)
  const legacyHub = join(TEST_DIR, "legacy_hub");
  mkdirSync(join(legacyHub, ".vega"), { recursive: true });
  const legacyFsrsNew = {
    due: "2026-10-10T08:00:00.000Z",
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    learning_steps: 0,
  };
  const legacyCollection = {
    version: 1,
    settings: { request_retention: 0.9, maximum_interval: 36500, enable_fuzz: false },
    cards: [
      {
        id: "c_legacy_1",
        subject: "AI Agents 101",
        deck: "01-vong-lap-agent",
        kind: "basic",
        front: "Thẻ cũ 1",
        back: "Đáp án 1",
        hook: "Mỏ neo cũ",
        origin: { kind: "aurora-notebook", path: "D:/x/deck.json", locator: "slide 12 (notebook)" },
        tags: ["react"],
        created: "2026-10-10T08:00:00.000Z",
        fsrs: legacyFsrsNew,
      },
      {
        id: "c_legacy_2",
        subject: "AI Agents 101",
        kind: "cloze",
        front: "ReAct dùng [[Thought]] và [[Action]]",
        back: "ReAct dùng Thought và Action",
        origin: { kind: "polaris-fact", path: "D:/x/facts.json", locator: "fact F2" },
        tags: [],
        created: "2026-10-09T08:00:00.000Z",
        suspended: true,
        fsrs: {
          ...legacyFsrsNew,
          state: 2,
          reps: 3,
          stability: 9.5,
          difficulty: 5.1,
          scheduled_days: 9,
          due: "2026-10-11T08:00:00.000Z",
          last_review: "2026-10-02T08:00:00.000Z",
        },
      },
    ],
  };
  writeFileSync(join(legacyHub, ".vega", "cards.json"), JSON.stringify(legacyCollection, null, 2), "utf8");
  const loadedLegacy = await vegaLib.loadCollection(legacyHub);
  ok(
    "an old cards.json (no key, no origin.href) still loads unchanged",
    loadedLegacy.cards.length === 2 &&
      isDeepStrictEqual(JSON.parse(JSON.stringify(loadedLegacy.cards)), legacyCollection.cards) &&
      loadedLegacy.cards.every((c) => c.key === undefined && c.origin.href === undefined),
  );
  r = await call("vega_due", { date: "2026-10-12", hub: legacyHub });
  ok("the old collection still serves the due queue", !r.isError && textOf(r).includes("Total in queue: 1"), textOf(r).split("\n")[1]);
  r = await call("vega_stats", { date: "2026-10-12", hub: legacyHub });
  ok("the old collection still serves stats", !r.isError && textOf(r).includes("Total Cards: 2") && textOf(r).includes("Suspended (1)"));
  writeInboxFile(legacyHub, "manual-20261012T180000-0000bb.jsonl", [
    { ...minimalMiraLine, producer: "manual", key: "manual:ghi-chu:2", origin: { kind: "manual", path: "ghi-chu.md" } },
  ]);
  r = await call("vega_inbox", { action: "ingest", hub: legacyHub });
  const legacyAfter = readCards(legacyHub);
  ok(
    "ingesting into an old collection appends the new card and leaves the old cards untouched",
    textOf(r).includes("Thẻ mới tạo: 1") &&
      legacyAfter.length === 3 &&
      isDeepStrictEqual(legacyAfter.slice(0, 2), legacyCollection.cards) &&
      legacyAfter.slice(0, 2).every((c) => !("key" in c) && !("href" in c.origin)) &&
      legacyAfter[2].key === "manual:ghi-chu:2",
  );
  const realCardsSource = "D:/02_Learning_Knowledge/.vega/cards.json";
  if (existsSync(realCardsSource)) {
    const realHub = join(TEST_DIR, "real_cards_copy_hub");
    mkdirSync(join(realHub, ".vega"), { recursive: true });
    copyFileSync(realCardsSource, join(realHub, ".vega", "cards.json"));
    const rawReal = JSON.parse(readFileSync(join(realHub, ".vega", "cards.json"), "utf8"));
    const loadedReal = await vegaLib.loadCollection(realHub);
    ok(
      "a copy of the learner's real cards.json (written before v0.3.0) loads unchanged",
      loadedReal.cards.length === rawReal.cards.length &&
        isDeepStrictEqual(JSON.parse(JSON.stringify(loadedReal.cards)), rawReal.cards),
      `${loadedReal.cards.length} card(s)`,
    );
  }

  // Validator: every rule of the contract table
  const V = vegaLib.validateInboxLine;
  const rejects = (label, mutate, needle) => {
    const line = JSON.parse(JSON.stringify(mkLine()));
    mutate(line);
    const res = V(line);
    ok(`validator rejects ${label}`, res.ok === false && res.errors.some((e) => e.includes(needle)), res.ok ? "accepted" : res.errors.join(" | "));
  };
  rejects("an unknown field", (l) => { l.foo = 1; }, 'trường lạ không được phép: "foo"');
  rejects("v other than 1", (l) => { l.v = 2; }, '"v" phải là số nguyên 1');
  rejects("a missing v", (l) => { delete l.v; }, 'thiếu trường bắt buộc "v"');
  rejects("a date-only t", (l) => { l.t = "2026-10-12"; }, '"t" phải là thời điểm ISO 8601');
  rejects("a t without offset", (l) => { l.t = "2026-10-12T08:00:00"; }, '"t" phải là thời điểm ISO 8601');
  rejects("an impossible calendar date", (l) => { l.t = "2026-02-30T08:00:00Z"; }, '"t" phải là thời điểm ISO 8601');
  rejects("an unknown producer", (l) => { l.producer = "claude"; }, '"producer" phải là một trong');
  rejects("a key without the producer prefix", (l) => { l.key = "polaris:x"; }, '"key" phải bắt đầu bằng "mira:"');
  rejects("a key that is only the prefix", (l) => { l.key = "mira:"; }, '"key" phải bắt đầu bằng "mira:"');
  rejects("a key longer than 200", (l) => { l.key = "mira:" + "k".repeat(196); }, "quá dài (201 ký tự, tối đa 200)");
  rejects("an empty subject", (l) => { l.subject = " "; }, '"subject" không được rỗng');
  rejects("a subject longer than 120", (l) => { l.subject = "s".repeat(121); }, '"subject" quá dài (121 ký tự, tối đa 120)');
  rejects("a deck longer than 120", (l) => { l.deck = "d".repeat(121); }, '"deck" quá dài');
  rejects("kind palace", (l) => { l.kind = "palace"; }, '"kind" phải là một trong: basic, cloze, reverse');
  rejects("an empty front", (l) => { l.front = ""; }, '"front" không được rỗng');
  rejects("a front longer than 600", (l) => { l.front = "f".repeat(601); }, "quá dài (601 ký tự, tối đa 600)");
  // Emoji are built from code points so that this file stays free of them
  rejects("an emoji in front", (l) => { l.front = `Đúng rồi ${String.fromCodePoint(0x2705)}`; }, '"front" không được chứa emoji');
  rejects("a supplementary-plane emoji in front", (l) => { l.front = `Mèo ${String.fromCodePoint(0x1f431)}`; }, '"front" không được chứa emoji');
  rejects("an emoji-style variation selector in front", (l) => { l.front = `Tim ${String.fromCodePoint(0x2764, 0xfe0f)}`; }, '"front" không được chứa emoji');
  ok(
    "text-style symbols (check mark, double arrow, copyright, trademark) are not emoji and stay allowed in front",
    V(mkLine({ front: `Ký hiệu ${String.fromCodePoint(0x2713, 0x20, 0x2194, 0x20, 0xa9, 0x20, 0x2122)} trong câu hỏi` })).ok === true,
  );
  rejects("a missing back", (l) => { delete l.back; }, 'thiếu trường bắt buộc "back"');
  rejects("a back longer than 1200", (l) => { l.back = "b".repeat(1201); }, "quá dài (1201 ký tự, tối đa 1200)");
  rejects("a hint longer than 200", (l) => { l.hint = "h".repeat(201); }, '"hint" quá dài');
  rejects("a hook longer than 200", (l) => { l.hook = "h".repeat(201); }, '"hook" quá dài');
  rejects("a reason longer than 200", (l) => { l.reason = "r".repeat(201); }, '"reason" quá dài');
  rejects("a null optional field", (l) => { l.deck = null; }, '"deck" phải là chuỗi');
  rejects("a missing origin", (l) => { delete l.origin; }, 'thiếu trường bắt buộc "origin"');
  rejects("an origin kind outside the contract", (l) => { l.origin.kind = "aurora-notebook"; }, '"origin.kind" phải là một trong');
  rejects("an empty origin.path", (l) => { l.origin.path = ""; }, '"origin.path" không được rỗng');
  rejects("an origin.locator longer than 120", (l) => { l.origin.locator = "l".repeat(121); }, '"origin.locator" quá dài');
  rejects("an origin.href longer than 400", (l) => { l.origin.href = "h".repeat(401); }, '"origin.href" quá dài (401 ký tự, tối đa 400)');
  rejects("an unknown origin field", (l) => { l.origin.extra = 1; }, 'trường lạ không được phép trong "origin": "extra"');
  rejects("11 tags", (l) => { l.tags = Array.from({ length: 11 }, (_, i) => `t${i}`); }, '"tags" có 11 phần tử, tối đa 10');
  rejects("an empty tag", (l) => { l.tags = ["ok", ""]; }, '"tags[1]" phải dài 1-40 ký tự');
  rejects("a tag longer than 40", (l) => { l.tags = ["t".repeat(41)]; }, '"tags[0]" phải dài 1-40 ký tự');
  rejects("tags that is not an array", (l) => { l.tags = "python"; }, '"tags" phải là mảng chuỗi');
  for (const [label, value] of [["an array", [1]], ["a string", "x"], ["null", null], ["a number", 5]]) {
    const res = V(value);
    ok(`validator rejects a line that is ${label}`, res.ok === false && res.errors[0] === "dòng phải là một đối tượng JSON");
  }
  const everyProblem = V({});
  ok(
    "validator reports every problem of a line, not only the first",
    everyProblem.ok === false && everyProblem.errors.length === 8,
    everyProblem.ok ? "accepted" : `${everyProblem.errors.length} errors`,
  );
  const manyUnknown = V({ ...mkLine(), [`long${"n".repeat(100)}`]: 1, ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`x${i}`, 1])) });
  ok(
    "a report about unknown fields stays bounded (8 names, shortened long names, a count of the rest)",
    manyUnknown.ok === false && manyUnknown.errors[0].includes("(+5)") && manyUnknown.errors[0].length < 200,
    manyUnknown.ok ? "accepted" : manyUnknown.errors[0].slice(0, 100),
  );
  const boundaryRes = V(
    mkLine({
      key: "mira:" + "k".repeat(195),
      subject: "s".repeat(120),
      deck: "d".repeat(120),
      front: "ệ".repeat(600),
      back: "b".repeat(1200),
      hint: "h".repeat(200),
      hook: "o".repeat(200),
      reason: "r".repeat(200),
      origin: { kind: "mira-stop", path: "p".repeat(400), locator: "l".repeat(120), href: "h".repeat(400) },
      tags: Array.from({ length: 10 }, (_, i) => `${"t".repeat(39)}${i}`),
    }),
  );
  ok(
    "validator accepts every field at its maximum length (600 Vietnamese characters in front, 10 tags of 40)",
    boundaryRes.ok === true,
    boundaryRes.ok ? "" : boundaryRes.errors.join(" | "),
  );
  const minimalRes = V(minimalMiraLine);
  ok(
    "validator accepts the minimal line and applies the defaults (kind basic, no tags)",
    minimalRes.ok === true && minimalRes.line.kind === "basic" && minimalRes.line.tags.length === 0,
  );
  ok(
    "ISO 8601 check follows the real calendar (leap day, hour 24, offset range)",
    vegaLib.isIsoDateTimeWithOffset("2024-02-29T00:00:00Z") &&
      vegaLib.isIsoDateTimeWithOffset("2026-10-12T08:00:00.123456+07:00") &&
      !vegaLib.isIsoDateTimeWithOffset("2025-02-29T00:00:00Z") &&
      !vegaLib.isIsoDateTimeWithOffset("2026-10-12T24:00:00Z") &&
      !vegaLib.isIsoDateTimeWithOffset("2026-10-12T08:00:00+24:00"),
  );

  // origin.href becomes a clickable link in the lesson page: script-capable schemes are refused
  rejects("a javascript: href", (l) => { l.origin.href = "javascript:alert(1)"; }, '"origin.href" không được dùng giao thức');
  rejects("a javascript: href disguised with case, tab and spaces", (l) => { l.origin.href = "  JaVa\tScRiPt:alert(1)"; }, '"origin.href" không được dùng giao thức');
  rejects("a data: href", (l) => { l.origin.href = "data:text/html;base64,PHNjcmlwdD4="; }, '"origin.href" không được dùng giao thức');
  rejects("a vbscript: href", (l) => { l.origin.href = "vbscript:msgbox(1)"; }, '"origin.href" không được dùng giao thức');
  ok(
    "validator accepts file:, http(s):, relative, fragment and app-scheme hrefs",
    ["file:///C:/x.html#stop-3", "https://example.com/p#stop-3", "../mira/p.html#stop-3", "#stop-3", "vscode://file/C:/x"].every(
      (h) => V(mkLine({ origin: { kind: "mira-stop", path: "p", href: h } })).ok === true,
    ),
  );
  let unsafeAddRejected = false;
  try {
    const bad = await call("vega_add", {
      hub: inboxHub,
      cards: [{ subject: "S", front: "F", back: "B", origin: { kind: "manual", path: "p", href: "javascript:alert(1)" } }],
    });
    unsafeAddRejected = bad.isError === true;
  } catch {
    unsafeAddRejected = true;
  }
  ok(
    "vega_add refuses an origin.href that uses a script scheme",
    unsafeAddRejected && readCards(inboxHub).every((c) => c.origin.href !== "javascript:alert(1)"),
  );

  // Parallel calls in one process must not race on the same inbox files
  const raceHub = join(TEST_DIR, "race_hub");
  writeInboxFile(raceHub, "mira-20261012T200000-aa0001.jsonl", [miraStop(1), miraStop(2), miraStop(3)]);
  const [raceA, raceB] = await Promise.all([vegaLib.ingestInbox(raceHub), vegaLib.ingestInbox(raceHub)]);
  const raceCards = readCards(raceHub);
  ok(
    "two ingests started together are serialized: 3 cards in total, no archive error, one run does the work",
    raceA.cards_created + raceB.cards_created === 3 &&
      Math.min(raceA.files_read, raceB.files_read) === 0 &&
      raceA.file_errors.length === 0 &&
      raceB.file_errors.length === 0 &&
      raceCards.length === 3 &&
      new Set(raceCards.map((c) => c.key)).size === 3,
    `${raceA.cards_created}+${raceB.cards_created} created`,
  );
  const raceHubMcp = join(TEST_DIR, "race_hub_mcp");
  writeInboxFile(raceHubMcp, "mira-20261012T200100-aa0002.jsonl", [miraStop(1), miraStop(2)]);
  const [raceSync, raceIngest] = await Promise.all([
    call("vega_sync", { hub: raceHubMcp }),
    call("vega_inbox", { action: "ingest", hub: raceHubMcp }),
  ]);
  const raceTexts = textOf(raceSync) + "\n" + textOf(raceIngest);
  ok(
    "vega_sync and vega_inbox ingest called in parallel: both succeed, 2 cards, no archive error",
    !raceSync.isError &&
      !raceIngest.isError &&
      readCards(raceHubMcp).length === 2 &&
      !raceTexts.includes("không chuyển được tệp"),
  );

  // Guide topic and docs mention the inbox
  r = await call("vega_guide", { topic: "inbox" });
  const guideInbox = textOf(r);
  ok(
    "vega_guide inbox: why one queue (both citations), producers, format, keys, per-line handling",
    !r.isError &&
      guideInbox.includes("Latimier, Peyre và Ramus, 2021") &&
      guideInbox.includes("doi:10.1007/s10648-020-09572-8") &&
      guideInbox.includes("Lindsey và cs., 2014") &&
      guideInbox.includes("doi:10.1177/0956797613504302") &&
      guideInbox.includes("polaris-errorlog") &&
      guideInbox.includes("orion-attempt") &&
      guideInbox.includes("mira-stop") &&
      guideInbox.includes(".jsonl.tmp") &&
      guideInbox.includes("inbox/done/") &&
      guideInbox.includes("inbox/rejected/") &&
      guideInbox.includes("_error") &&
      guideInbox.includes("polaris:<tên thư mục môn>:<mã mục>") &&
      guideInbox.includes("mira:<slug trình phát>:stop-<k>"),
  );
  r = await call("vega_guide");
  ok("vega_guide overview lists the inbox topic", textOf(r).includes("`inbox`") && textOf(r).includes("Available guide topics"));
  r = await call("vega_guide", { topic: "workflows" });
  ok("vega_guide workflows has the inbox step and keeps the others", textOf(r).includes("vega_inbox") && textOf(r).includes("Discovery") && textOf(r).includes("vega_session"));
  r = await call("vega_guide", { topic: "origins" });
  ok("vega_guide origins lists the new kinds, origin.href and key", ["polaris-selfcheck", "aurora-predict", "orion-attempt", "mira-stop", "origin.href", "key"].every((s) => textOf(r).includes(s)));
  let invalidActionRejected = false;
  try {
    const bad = await call("vega_inbox", { action: "purge", hub: inboxHub });
    invalidActionRejected = bad.isError === true;
  } catch {
    invalidActionRejected = true;
  }
  ok("vega_inbox rejects an unknown action", invalidActionRejected);

} catch (e) {
  failed++;
  console.log(`FAIL unexpected error: ${e?.stack ?? e}`);
} finally {
  await client.close();
}

/* ───────── 5. CLI Interface Tests ───────── */

console.log("\n--- CLI Interface Tests ---");

const versionCli = execFileSync(process.execPath, [join(ROOT, "dist", "vega.mjs"), "version"], { encoding: "utf8" });
ok("CLI version prints 0.3.0", versionCli.trim() === "0.3.0", versionCli.trim());

const helpCli = execFileSync(process.execPath, [join(ROOT, "dist", "vega.mjs"), "help"], { encoding: "utf8" });
ok(
  "CLI help lists commands",
  helpCli.includes("due") &&
    helpCli.includes("review") &&
    helpCli.includes("stats") &&
    helpCli.includes("candidates") &&
    helpCli.includes("session") &&
    helpCli.includes("sync") &&
    helpCli.includes("inbox <list|ingest>") &&
    helpCli.includes("inbox"),
);

const guideInboxCli = execFileSync(process.execPath, [join(ROOT, "dist", "vega.mjs"), "guide", "inbox"], { encoding: "utf8" });
ok(
  "CLI guide inbox prints the inbox guide",
  guideInboxCli.includes("vega-card-inbox.v1") &&
    guideInboxCli.includes("10.1007/s10648-020-09572-8") &&
    guideInboxCli.includes("10.1177/0956797613504302"),
);

const guideCli = execFileSync(process.execPath, [join(ROOT, "dist", "vega.mjs"), "guide", "session"], { encoding: "utf8" });
ok("CLI guide session prints session guide", guideCli.includes("vega_session") && guideCli.includes("progress.jsonl"));

const guideStatsCli = execFileSync(process.execPath, [join(ROOT, "dist", "vega.mjs"), "guide", "stats"], { encoding: "utf8" });
ok("CLI guide stats prints stats guide", guideStatsCli.includes("True Retention") && guideStatsCli.includes("Learning-step again"));

const sessionCli = execFileSync(
  process.execPath,
  [join(ROOT, "dist", "vega.mjs"), "session", "--hub", TEST_DIR, "--no-build", "--json"],
  { encoding: "utf8" },
);
const parsedSessionCli = JSON.parse(sessionCli);
ok("CLI session --json outputs session result", parsedSessionCli.deck_path && parsedSessionCli.session_dir);

const syncCli = execFileSync(
  process.execPath,
  [join(ROOT, "dist", "vega.mjs"), "sync", fixtureProgressFile, "--hub", TEST_DIR, "--json"],
  { encoding: "utf8" },
);
const parsedSyncCli = JSON.parse(syncCli);
ok("CLI sync --json outputs sync result", parsedSyncCli.skipped_duplicates >= 3 && parsedSyncCli.reviews_applied === 0);

const candidatesCli = execFileSync(
  process.execPath,
  [join(ROOT, "dist", "vega.mjs"), "candidates", tempDeckPath, "--json"],
  { encoding: "utf8" },
);
const parsedCandidatesCli = JSON.parse(candidatesCli);
ok("CLI candidates --json outputs JSON candidates", Array.isArray(parsedCandidatesCli) && parsedCandidatesCli.length >= 4);

const dueCli = execFileSync(
  process.execPath,
  [join(ROOT, "dist", "vega.mjs"), "due", "--hub", TEST_DIR, "--date", "2026-10-11", "--json"],
  { encoding: "utf8" },
);
const parsedDueCli = JSON.parse(dueCli);
ok("CLI due --json outputs due queue result", parsedDueCli.date === "2026-10-11" && Array.isArray(parsedDueCli.queue));

const statsCli = execFileSync(
  process.execPath,
  [join(ROOT, "dist", "vega.mjs"), "stats", "--hub", TEST_DIR],
  { encoding: "utf8" },
);
ok("CLI stats prints summary", statsCli.includes("Vega Memory Collection Stats") && statsCli.includes("By State:"));

// Card inbox through the CLI (hub under %TEMP%)
const cliInboxHub = join(TEST_DIR, "cli_inbox_hub");
const CLI_INBOX_NAME = "manual-20261012T190000-abc123.jsonl";
writeInboxFile(cliInboxHub, CLI_INBOX_NAME, [
  {
    v: 1,
    t: "2026-10-12T19:00:00+07:00",
    producer: "manual",
    key: "manual:cli:1",
    subject: "Python_Basics",
    front: "Thẻ gửi bằng CLI",
    back: "Đáp án.",
    origin: { kind: "manual", path: "ghi-chu.md" },
  },
  { v: 1, producer: "manual" },
]);
const cliInboxTree = treeSnapshot(join(cliInboxHub, ".vega"));
const inboxListCli = JSON.parse(
  execFileSync(process.execPath, [join(ROOT, "dist", "vega.mjs"), "inbox", "list", "--hub", cliInboxHub, "--json"], {
    encoding: "utf8",
  }),
);
ok(
  "CLI inbox list --json previews without writing",
  inboxListCli.pending_files === 1 &&
    inboxListCli.would_create === 1 &&
    inboxListCli.would_reject === 1 &&
    inboxListCli.files[0].file === CLI_INBOX_NAME &&
    treeSnapshot(join(cliInboxHub, ".vega")) === cliInboxTree,
);
const inboxListTextCli = execFileSync(process.execPath, [join(ROOT, "dist", "vega.mjs"), "inbox", "list", "--hub", cliInboxHub], {
  encoding: "utf8",
});
ok("CLI inbox list prints the Vietnamese report", inboxListTextCli.includes("Hộp thư thẻ Vega") && inboxListTextCli.includes(CLI_INBOX_NAME));
const inboxIngestCli = JSON.parse(
  execFileSync(process.execPath, [join(ROOT, "dist", "vega.mjs"), "inbox", "ingest", "--hub", cliInboxHub, "--json"], {
    encoding: "utf8",
  }),
);
ok(
  "CLI inbox ingest --json creates the card, archives the file, rejects the bad line",
  inboxIngestCli.cards_created === 1 &&
    inboxIngestCli.lines_rejected === 1 &&
    inboxIngestCli.files[0].moved_to === `done/${CLI_INBOX_NAME}` &&
    inboxIngestCli.files[0].rejected_to === `rejected/${CLI_INBOX_NAME}` &&
    readCards(cliInboxHub).some((c) => c.key === "manual:cli:1") &&
    existsSync(join(inboxDirOf(cliInboxHub), "done", CLI_INBOX_NAME)),
);
let cliNoActionStatus = 0;
try {
  execFileSync(process.execPath, [join(ROOT, "dist", "vega.mjs"), "inbox"], { stdio: "pipe" });
} catch (e) {
  cliNoActionStatus = e.status;
}
ok("CLI inbox without an action exits with status 1", cliNoActionStatus === 1, `status ${cliNoActionStatus}`);
const syncInboxCli = JSON.parse(
  execFileSync(process.execPath, [join(ROOT, "dist", "vega.mjs"), "sync", "--hub", cliInboxHub, "--json"], {
    encoding: "utf8",
  }),
);
ok(
  "CLI sync --json carries the inbox result",
  syncInboxCli.inbox && syncInboxCli.inbox.files_read === 0 && syncInboxCli.inbox.cards_created === 0 && syncInboxCli.summary.includes("Hộp thư thẻ:"),
);

// Clean up temp directory
try {
  rmSync(TEST_DIR, { recursive: true, force: true });
} catch {
  // ignore
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll end-to-end checks passed.");
process.exit(failed ? 1 : 0);

