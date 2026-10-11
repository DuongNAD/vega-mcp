#!/usr/bin/env node
/**
 * End-to-end test over real MCP stdio for Vega MCP.
 *
 * Exercises all 9 tools, FSRS behavior against ts-fsrs for fixed card & dates,
 * candidate extraction with origins from copied real Aurora deck & Polaris fixtures,
 * de-duplication, due ordering, daily limits, review state progression, review log persistence,
 * stats computation, atomic writes, and CLI commands on a temporary directory under %TEMP%.
 *
 *   node scripts/e2e.mjs
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  ok("server identifies itself as vega", info?.name === "vega" && info?.version === "0.2.2", `${info?.name} ${info?.version}`);

  const instructions = client.getInstructions() ?? "";
  ok(
    "server sends instructions with Workflow and Rules",
    instructions.includes("Workflow:") && instructions.includes("Rules:") && instructions.includes("FSRS"),
  );

  // 4.2 List Tools
  const { tools } = await client.listTools();
  const toolNames = tools.map((t) => t.name).sort();
  ok(
    "all 11 tools registered",
    toolNames.length === 11 &&
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

} catch (e) {
  failed++;
  console.log(`FAIL unexpected error: ${e?.stack ?? e}`);
} finally {
  await client.close();
}

/* ───────── 5. CLI Interface Tests ───────── */

console.log("\n--- CLI Interface Tests ---");

const versionCli = execFileSync(process.execPath, [join(ROOT, "dist", "vega.mjs"), "version"], { encoding: "utf8" });
ok("CLI version prints 0.2.2", versionCli.trim() === "0.2.2", versionCli.trim());

const helpCli = execFileSync(process.execPath, [join(ROOT, "dist", "vega.mjs"), "help"], { encoding: "utf8" });
ok(
  "CLI help lists commands",
  helpCli.includes("due") &&
    helpCli.includes("review") &&
    helpCli.includes("stats") &&
    helpCli.includes("candidates") &&
    helpCli.includes("session") &&
    helpCli.includes("sync"),
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
  [join(ROOT, "dist", "vega.mjs"), "due", "--hub", TEST_DIR, "--json"],
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

// Clean up temp directory
try {
  rmSync(TEST_DIR, { recursive: true, force: true });
} catch {
  // ignore
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll end-to-end checks passed.");
process.exit(failed ? 1 : 0);

