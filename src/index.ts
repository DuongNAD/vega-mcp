/**
 * Vega MCP: Adaptive Spaced Repetition (FSRS) Server & CLI.
 *
 *   node dist/vega.mjs                 -> MCP server on stdio
 *   node dist/vega.mjs session         -> CLI build today's review session deck
 *   node dist/vega.mjs sync [file]     -> CLI sync Aurora progress ratings to FSRS
 *   node dist/vega.mjs due             -> CLI list today's due queue
 *   node dist/vega.mjs review <id> <r> -> CLI review a card
 *   node dist/vega.mjs stats           -> CLI view collection stats
 *   node dist/vega.mjs candidates <f>  -> CLI extract card candidates
 *   node dist/vega.mjs add <f>         -> CLI add cards
 *   node dist/vega.mjs guide [topic]   -> CLI view guide
 *   node dist/vega.mjs version         -> 0.2.1
 *   node dist/vega.mjs help            -> CLI command list
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { extractCandidates } from "./candidates.js";
import { stepFsrs, stateName } from "./fsrs.js";
import { getGuideTopic, GUIDE_TOPICS } from "./guide.js";
import {
  CARD_KINDS,
  CardInputSchema,
  CardPatchSchema,
  ORIGIN_KINDS,
  REVIEW_RATINGS,
  type Card,
  type CardInput,
  type CardPatch,
  type ReviewRating,
  type ReviewResult,
} from "./schema.js";
import { getDueQueue, getStats } from "./scheduler.js";
import { createSessionDeck } from "./session.js";
import {
  addCards,
  appendReviewLog,
  deleteCard,
  editCard,
  getCard,
  loadCollection,
  readReviewLogs,
  saveCollection,
  suspendCard,
} from "./store.js";
import { syncProgress } from "./sync.js";
import { errMsg, nowIso, parseDate, VERSION } from "./util.js";

export * from "./candidates.js";
export * from "./fsrs.js";
export * from "./guide.js";
export * from "./schema.js";
export * from "./scheduler.js";
export * from "./session.js";
export * from "./store.js";
export * from "./sync.js";
export * from "./util.js";

type Content = { type: "text"; text: string };
type ToolResult = { content: Content[]; isError?: boolean };

const text = (t: string, isError = false): ToolResult => ({
  content: [{ type: "text", text: t }],
  ...(isError ? { isError: true } : {}),
});

async function safe(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (e) {
    return text(errMsg(e), true);
  }
}

export const INSTRUCTIONS = `Vega MCP is the spaced-repetition memory engine (FSRS) across Polaris and Aurora learning materials.

Workflow:
1. vega_guide { topic? } to read card-writing rules, FSRS principles, session decks, and workflows.
2. vega_candidates { path, from? } to extract raw candidate cards from Polaris facts/error logs or Aurora decks.
3. Rewrite candidates following card rules (atomic idea, cloze for terms, keep memory hook, Vietnamese learner text).
4. vega_add { cards } to validate, de-duplicate, and assign initial FSRS states.
5. vega_due { subject?, limit?, date? } to inspect today's review queue and workload forecast.
6. vega_session { date?, limit?, subject?, build? } to write today's review session into <hub>/.vega/session/ as an Aurora deck.
7. Study the session via aurora_preview or browser, rating cards with 1-4.
8. vega_sync { file? } to sync ratings from progress.jsonl back into FSRS idempotently.
9. vega_stats { subject? } to inspect true retention, leech cards, and upcoming workload.

Rules:
- Atomic cards: exactly one idea per card; no unordered lists to recite.
- Learner fit: learner-facing card text in the learner's language (Vietnamese by default with correct diacritics); no emoji.
- Origin fidelity: never invent facts beyond the origin; every card must have a verifiable origin and locator.
- Proven algorithm: FSRS with desired retention 0.9 by default; cards live in VEGA_HUB/.vega/.
- Never scan D: recursively; open files directly.

Done when:
Cards are extracted, validated with origins, scheduled via FSRS, reviewed in Aurora sessions, and synced back with atomic persistence.`;

export function createServer(): McpServer {
  const server = new McpServer({ name: "vega", version: VERSION }, { instructions: INSTRUCTIONS });

  /* 1. vega_guide */
  server.registerTool(
    "vega_guide",
    {
      title: "Vega Guide & Spaced Repetition Documentation",
      description:
        "READ FIRST. Card-writing rules with Vietnamese examples, FSRS principles in plain words, and study workflows. No argument = overview.",
      inputSchema: {
        topic: z.enum(GUIDE_TOPICS).optional().describe(`Topic: ${GUIDE_TOPICS.join(" | ")}`),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ topic }) => safe(async () => text(getGuideTopic(topic))),
  );

  /* 2. vega_candidates */
  server.registerTool(
    "vega_candidates",
    {
      title: "Extract Card Candidates from Learning Materials",
      description:
        "Deterministic extraction of card candidates from Polaris facts.json, errorlog.md, or Aurora deck.json. Does not save cards to the collection.",
      inputSchema: {
        path: z.string().min(1).describe("Path to source file (facts.json, errorlog.md, deck.json)"),
        from: z
          .enum(["polaris-facts", "polaris-errorlog", "aurora-deck", "auto"])
          .optional()
          .default("auto")
          .describe("Source type"),
        subject: z.string().optional().describe("Subject name override"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ path, from, subject }) =>
      safe(async () => {
        const candidates = await extractCandidates(path, { from, subject });
        return text(
          `Extracted ${candidates.length} candidate card(s) from ${path}:\n\n${JSON.stringify(candidates, null, 2)}`,
        );
      }),
  );

  /* 3. vega_add */
  server.registerTool(
    "vega_add",
    {
      title: "Add Cards to Vega Collection",
      description:
        "Validate, de-duplicate (same origin + front), assign unique IDs, initialize FSRS state, and append cards to cards.json.",
      inputSchema: {
        cards: z.array(CardInputSchema).min(1).describe("Array of cards to add"),
        hub: z.string().optional().describe("Learning hub root directory (default: VEGA_HUB or D:/02_Learning_Knowledge)"),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ cards, hub }) =>
      safe(async () => {
        const res = await addCards(cards, hub);
        const summary = [
          `Added ${res.added.length} card(s) to collection (Skipped ${res.skipped} duplicate(s), Total in collection: ${res.total}).`,
        ];
        if (res.added.length > 0) {
          summary.push("", "Added cards:", ...res.added.map((c) => `  - [${c.id}] (${c.kind}) ${c.front.slice(0, 60)}`));
        }
        return text(summary.join("\n"));
      }),
  );

  /* 4. vega_edit */
  server.registerTool(
    "vega_edit",
    {
      title: "Edit an Existing Card",
      description: "Update fields of a card (front, back, hint, hook, tags, subject, deck, suspended) in cards.json.",
      inputSchema: {
        id: z.string().min(1).describe("Card ID"),
        patch: CardPatchSchema.describe("Fields to update"),
        hub: z.string().optional().describe("Learning hub root directory"),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, patch, hub }) =>
      safe(async () => {
        const updated = await editCard(id, patch, hub);
        return text(`Card ${id} updated successfully:\n${JSON.stringify(updated, null, 2)}`);
      }),
  );

  /* 5. vega_suspend */
  server.registerTool(
    "vega_suspend",
    {
      title: "Suspend or Unsuspend a Card",
      description: "Pause or unpause a card from appearing in due review queues.",
      inputSchema: {
        id: z.string().min(1).describe("Card ID"),
        suspended: z.boolean().optional().describe("True to suspend, false to resume (default: toggle)"),
        hub: z.string().optional().describe("Learning hub root directory"),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, suspended, hub }) =>
      safe(async () => {
        const card = await suspendCard(id, suspended, hub);
        return text(`Card ${id} is now ${card.suspended ? "SUSPENDED (paused from queue)" : "ACTIVE"}.`);
      }),
  );

  /* 6. vega_delete */
  server.registerTool(
    "vega_delete",
    {
      title: "Soft-Delete a Card",
      description: "Remove card from active collection and record soft deletion event in reviews.jsonl.",
      inputSchema: {
        id: z.string().min(1).describe("Card ID"),
        hub: z.string().optional().describe("Learning hub root directory"),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, hub }) =>
      safe(async () => {
        const { deleted } = await deleteCard(id, hub);
        return text(`Card ${id} soft-deleted. Logged to review history.`);
      }),
  );

  /* 7. vega_due */
  server.registerTool(
    "vega_due",
    {
      title: "Get Today's Review Queue",
      description:
        "Fetch today's study queue (overdue first, then due today, then a capped number of new cards, default 10 new / 100 total) and 7-day forecast.",
      inputSchema: {
        subject: z.string().optional().describe("Filter by subject"),
        limit: z.number().int().min(1).optional().default(100).describe("Max total cards in queue"),
        new_limit: z.number().int().min(0).optional().default(10).describe("Max new cards per day"),
        date: z.string().optional().describe("Target date (YYYY-MM-DD, default today)"),
        hub: z.string().optional().describe("Learning hub root directory"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ subject, limit, new_limit, date, hub }) =>
      safe(async () => {
        const res = await getDueQueue({ subject, limit, new_limit, date, hub });
        const lines = [
          res.summary,
          "",
          `Queue items (${res.queue.length}):`,
          ...res.queue.map(
            (c, i) =>
              `${i + 1}. [${c.id}] [${stateName(c.fsrs.state)}] ${c.front.slice(0, 70)}${c.hook ? ` (Hook: ${c.hook})` : ""}`,
          ),
        ];
        return text(lines.join("\n"));
      }),
  );

  /* 8. vega_review */
  server.registerTool(
    "vega_review",
    {
      title: "Submit a Review Rating for a Card",
      description:
        "Advance card FSRS state using rating (again | hard | good | easy) and append record to reviews.jsonl.",
      inputSchema: {
        id: z.string().min(1).describe("Card ID"),
        rating: z.enum(REVIEW_RATINGS).describe("Rating: again (1) | hard (2) | good (3) | easy (4)"),
        ms: z.number().int().min(0).optional().describe("Response time in milliseconds"),
        date: z.string().optional().describe("Review timestamp (ISO date-time or YYYY-MM-DD, default now)"),
        via: z.enum(["tool", "aurora"]).optional().default("tool"),
        hub: z.string().optional().describe("Learning hub root directory"),
      },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ id, rating, ms, date, via, hub }) =>
      safe(async () => {
        const collection = await loadCollection(hub);
        const cardIndex = collection.cards.findIndex((c) => c.id === id);
        if (cardIndex === -1) {
          throw new Error(`Card not found with ID: ${id}`);
        }

        const card = collection.cards[cardIndex]!;
        const reviewDate = date ? parseDate(date) : new Date();
        const stateBeforeNum = card.fsrs.state;
        const stateBeforeName = stateName(stateBeforeNum);
        const dueBefore = card.fsrs.due;

        const { nextState, elapsedDays, scheduledDays } = stepFsrs(
          card.fsrs,
          rating,
          reviewDate,
          collection.settings,
        );

        card.fsrs = nextState;
        await saveCollection(collection, hub);

        await appendReviewLog(
          {
            t: reviewDate.toISOString(),
            card: id,
            rating,
            state_before: stateBeforeNum,
            due_before: dueBefore,
            elapsed_days: elapsedDays,
            ms,
            via: via ?? "tool",
          },
          hub,
        );

        const stateAfterName = stateName(card.fsrs.state);
        const summary = [
          `Card ${id} reviewed with rating '${rating}':`,
          `- State: ${stateBeforeName} -> ${stateAfterName}`,
          `- Stability: ${card.fsrs.stability} days`,
          `- Difficulty: ${card.fsrs.difficulty}`,
          `- Next interval: ${scheduledDays} day(s)`,
          `- Next due: ${card.fsrs.due}`,
        ].join("\n");

        return text(summary);
      }),
  );

  /* 9. vega_stats */
  server.registerTool(
    "vega_stats",
    {
      title: "View Collection Statistics and Workload Forecast",
      description:
        "Display total cards by state, reviews today, 30-day true retention, leech cards (lapses >= 6), and 7-day workload forecast.",
      inputSchema: {
        subject: z.string().optional().describe("Filter by subject"),
        date: z.string().optional().describe("Target date (YYYY-MM-DD, default today)"),
        hub: z.string().optional().describe("Learning hub root directory"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ subject, date, hub }) =>
      safe(async () => {
        const stats = await getStats({ subject, date, hub });
        return text(stats.summary);
      }),
  );

  /* 10. vega_session */
  server.registerTool(
    "vega_session",
    {
      title: "Generate Daily Review Session as Aurora Deck",
      description:
        "Write today's review queue into fixed folder <collection>/session/deck.json with title, srs, and summary slides, and build with Aurora CLI.",
      inputSchema: {
        date: z.string().optional().describe("Target date (YYYY-MM-DD, default today)"),
        limit: z.number().int().min(1).optional().default(100).describe("Max total cards in session"),
        new_limit: z.number().int().min(0).optional().default(10).describe("Max new cards per day"),
        subject: z.string().optional().describe("Filter by subject"),
        build: z.boolean().optional().default(true).describe("Compile session deck with Aurora CLI"),
        hub: z.string().optional().describe("Learning hub root directory"),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ date, limit, new_limit, subject, build, hub }) =>
      safe(async () => {
        const res = await createSessionDeck({ date, limit, new_limit, subject, build, hub });
        return text(res.summary);
      }),
  );

  /* 11. vega_sync */
  server.registerTool(
    "vega_sync",
    {
      title: "Synchronize Review Ratings from Aurora Progress Events",
      description:
        "Read <collection>/session/progress.jsonl and/or an exported progress file, apply card ratings in time order to FSRS idempotently, and update sync-state.json.",
      inputSchema: {
        file: z.string().optional().describe("Optional path to exported .jsonl progress file"),
        hub: z.string().optional().describe("Learning hub root directory"),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ file, hub }) =>
      safe(async () => {
        const res = await syncProgress({ file, hub });
        return text(res.summary);
      }),
  );

  /* ───────── MCP Prompts ───────── */

  server.registerPrompt(
    "review_today",
    {
      title: "Daily Spaced Repetition Review",
      description: "Run end-to-end daily review session with Vega and Aurora Slides",
      argsSchema: {
        date: z.string().optional().describe("Target review date (YYYY-MM-DD)"),
        subject: z.string().optional().describe("Filter review by subject"),
        hub: z.string().optional().describe("Learning hub root directory"),
      },
    },
    ({ date, subject, hub }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Execute the daily spaced repetition review session:",
              "1. Sync existing progress first: Call tool vega_sync {} to ensure cards and FSRS states are up to date.",
              `2. Generate today's review deck: Call tool vega_session {${date ? ` date: "${date}",` : ""}${subject ? ` subject: "${subject}",` : ""}${hub ? ` hub: "${hub}",` : ""} build: true }.`,
              "3. Study the review session interactively:",
              "   - Live preview with auto-reload: Call tool aurora_preview { dir: \"<session_dir>\", open: true }",
              "   - Or open <session_dir>/index.html in the browser.",
              "   - Rate each card using keys 1 (Again), 2 (Hard), 3 (Good), 4 (Easy) or the rating buttons.",
              "4. Sync review results back into FSRS: Once the study session is complete, call tool vega_sync {} to apply ratings to FSRS memory states.",
              "5. Check retention statistics: Call tool vega_stats {} to review updated retention and upcoming workload.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "make_cards",
    {
      title: "Author High-Quality Flashcards from Learning Materials",
      description: "Extract candidates from Polaris/Aurora and author standardized Vega flashcards",
      argsSchema: {
        path: z.string().describe("Source file path (Polaris facts.json, errorlog.md, or Aurora deck.json)"),
        subject: z.string().optional().describe("Subject name override"),
        hub: z.string().optional().describe("Learning hub root directory"),
      },
    },
    ({ path, subject, hub }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Extract and author standardized Vega flashcards from: ${path}`,
              "",
              "Follow this 3-step authoring workflow:",
              `1. Extract candidate cards: Call tool vega_candidates { path: "${path}"${subject ? `, subject: "${subject}"` : ""} }.`,
              "2. Refine candidates according to the 6 Card-Writing Rules (read vega_guide rules):",
              "   - Rule 1 (Atomic): Exactly one concept per card; no multi-item recitations.",
              "   - Rule 2 (Cloze): Use [[terms]] for definitions, formulas, or key tokens.",
              "   - Rule 3 (No bare lists): Test distinctions, causes, or mechanisms instead of reciting lists.",
              "   - Rule 4 (Preserve Hooks): Maintain memory palace stations, analogies, or vivid imagery in hook.",
              "   - Rule 5 (Learner Language): Clear Vietnamese text with standard international technical terms.",
              "   - Rule 6 (Origin Fidelity): Strictly keep origin path and locator pointing to the source file.",
              `3. Add refined cards: Call tool vega_add { cards: [...], hub: "${hub ?? ""}" } to validate and initialize FSRS.`,
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}

export async function startMcp(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/* ───────── CLI Runner ───────── */

export async function cli(argv: string[]): Promise<number> {
  const cmd = argv[0]?.toLowerCase() ?? "help";
  const isJson = argv.includes("--json");

  const getArg = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    if (idx !== -1 && idx + 1 < argv.length) return argv[idx + 1];
    return undefined;
  };

  switch (cmd) {
    case "version":
    case "-v":
    case "--version": {
      console.log(VERSION);
      return 0;
    }

    case "help":
    case "-h":
    case "--help": {
      console.log(`Vega MCP v${VERSION} - Adaptive Spaced Repetition Engine

Usage: node dist/vega.mjs <command> [options]

Commands:
  session                 Generate today's review session deck (<hub>/.vega/session/)
                          Options: [--date <YYYY-MM-DD>] [--limit <n>] [--new-limit <n>] [--subject <sub>] [--no-build] [--hub <dir>] [--json]
  sync [file]             Sync ratings from Aurora progress.jsonl / exported .jsonl into FSRS
                          Options: [--file <file>] [--hub <dir>] [--json]
  due                     Show today's due queue and forecast
                          Options: [--subject <sub>] [--limit <n>] [--new-limit <n>] [--date <YYYY-MM-DD>] [--hub <dir>] [--json]
  review <id> <rating>    Submit review rating (again, hard, good, easy)
                          Options: [--ms <ms>] [--date <YYYY-MM-DD>] [--hub <dir>] [--json]
  stats                   View collection stats and retention
                          Options: [--subject <sub>] [--date <YYYY-MM-DD>] [--hub <dir>] [--json]
  candidates <file>       Extract card candidates from source file
                          Options: [--from <polaris-facts|polaris-errorlog|aurora-deck>] [--subject <sub>] [--json]
  add <file|json>         Add cards to collection
                          Options: [--hub <dir>] [--json]
  edit <id> <json>        Edit existing card
  suspend <id> [bool]     Suspend/resume card
  delete <id>             Soft delete card
  guide [topic]           View documentation topic (${GUIDE_TOPICS.join(", ")})
  version                 Print version (${VERSION})
  help                    Print this help
`);
      return 0;
    }

    case "guide": {
      const topic = argv[1];
      console.log(getGuideTopic(topic));
      return 0;
    }

    case "session": {
      const date = getArg("--date");
      const limitStr = getArg("--limit");
      const newLimitStr = getArg("--new-limit");
      const subject = getArg("--subject");
      const hub = getArg("--hub");
      const noBuild = argv.includes("--no-build");

      const limit = limitStr ? parseInt(limitStr, 10) : undefined;
      const new_limit = newLimitStr ? parseInt(newLimitStr, 10) : undefined;

      const res = await createSessionDeck({
        date,
        limit,
        new_limit,
        subject,
        build: !noBuild,
        hub,
      });

      if (isJson) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(res.summary);
      }
      return 0;
    }

    case "sync": {
      let file: string | undefined = undefined;
      const firstPos = argv[1];
      if (firstPos && !firstPos.startsWith("-")) {
        file = firstPos;
      } else {
        file = getArg("--file");
      }
      const hub = getArg("--hub");

      const res = await syncProgress({ file, hub });
      if (isJson) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(res.summary);
      }
      return 0;
    }

    case "due": {
      const subject = getArg("--subject");
      const limitStr = getArg("--limit");
      const newLimitStr = getArg("--new-limit");
      const date = getArg("--date");
      const hub = getArg("--hub");

      const limit = limitStr ? parseInt(limitStr, 10) : undefined;
      const new_limit = newLimitStr ? parseInt(newLimitStr, 10) : undefined;

      const res = await getDueQueue({ subject, limit, new_limit, date, hub });
      if (isJson) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(res.summary);
      }
      return 0;
    }

    case "review": {
      const id = argv[1];
      const ratingStr = argv[2]?.toLowerCase() as ReviewRating;
      if (!id || !ratingStr || !REVIEW_RATINGS.includes(ratingStr)) {
        console.error("Usage: vega review <card_id> <again|hard|good|easy> [--ms <ms>] [--date <date>] [--hub <hub>]");
        return 1;
      }
      const msStr = getArg("--ms");
      const date = getArg("--date");
      const hub = getArg("--hub");
      const ms = msStr ? parseInt(msStr, 10) : undefined;

      const collection = await loadCollection(hub);
      const card = collection.cards.find((c) => c.id === id);
      if (!card) {
        console.error(`Error: Card not found with ID: ${id}`);
        return 1;
      }

      const reviewDate = date ? parseDate(date) : new Date();
      const stateBeforeNum = card.fsrs.state;
      const dueBefore = card.fsrs.due;

      const { nextState, elapsedDays, scheduledDays } = stepFsrs(
        card.fsrs,
        ratingStr,
        reviewDate,
        collection.settings,
      );

      card.fsrs = nextState;
      await saveCollection(collection, hub);

      await appendReviewLog(
        {
          t: reviewDate.toISOString(),
          card: id,
          rating: ratingStr,
          state_before: stateBeforeNum,
          due_before: dueBefore,
          elapsed_days: elapsedDays,
          ms,
          via: "tool",
        },
        hub,
      );

      if (isJson) {
        console.log(JSON.stringify({ id, rating: ratingStr, card }, null, 2));
      } else {
        console.log(`Card ${id} reviewed with '${ratingStr}'. Next due: ${card.fsrs.due} (in ${scheduledDays} days).`);
      }
      return 0;
    }

    case "stats": {
      const subject = getArg("--subject");
      const date = getArg("--date");
      const hub = getArg("--hub");

      const stats = await getStats({ subject, date, hub });
      if (isJson) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log(stats.summary);
      }
      return 0;
    }

    case "candidates": {
      const targetFile = argv[1];
      if (!targetFile) {
        console.error("Usage: vega candidates <file_path> [--from <type>] [--subject <sub>] [--json]");
        return 1;
      }
      const from = getArg("--from") as "polaris-facts" | "polaris-errorlog" | "aurora-deck" | "auto" | undefined;
      const subject = getArg("--subject");

      const candidates = await extractCandidates(resolve(targetFile), { from, subject });
      if (isJson) {
        console.log(JSON.stringify(candidates, null, 2));
      } else {
        console.log(`Extracted ${candidates.length} candidate(s) from ${targetFile}:`);
        candidates.forEach((c, i) => {
          console.log(`\n--- Candidate #${i + 1} (${c.kind}) ---`);
          console.log(`Front: ${c.front}`);
          console.log(`Back:  ${c.back}`);
          if (c.hook) console.log(`Hook:  ${c.hook}`);
          console.log(`Origin: ${c.origin.kind} | ${c.origin.path} | ${c.origin.locator ?? "N/A"}`);
        });
      }
      return 0;
    }

    case "add": {
      const inputArg = argv[1];
      if (!inputArg) {
        console.error("Usage: vega add <file_path_or_json> [--hub <hub>] [--json]");
        return 1;
      }
      const hub = getArg("--hub");

      let rawData: unknown;
      if (existsSync(inputArg)) {
        rawData = JSON.parse(readFileSync(inputArg, "utf8"));
      } else {
        rawData = JSON.parse(inputArg);
      }

      const cardList = Array.isArray(rawData) ? rawData : (rawData as { cards?: unknown[] })?.cards ?? [rawData];
      const parsedCards = cardList.map((c) => CardInputSchema.parse(c));
      const res = await addCards(parsedCards, hub);

      if (isJson) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(`Added ${res.added.length} card(s), skipped ${res.skipped} duplicate(s). Total: ${res.total}`);
      }
      return 0;
    }

    case "suspend": {
      const id = argv[1];
      if (!id) {
        console.error("Usage: vega suspend <card_id> [true|false] [--hub <hub>]");
        return 1;
      }
      const valStr = argv[2];
      const suspended = valStr !== undefined ? valStr === "true" || valStr === "1" : undefined;
      const hub = getArg("--hub");

      const card = await suspendCard(id, suspended, hub);
      console.log(`Card ${id} suspended: ${card.suspended}`);
      return 0;
    }

    case "delete": {
      const id = argv[1];
      if (!id) {
        console.error("Usage: vega delete <card_id> [--hub <hub>]");
        return 1;
      }
      const hub = getArg("--hub");
      const res = await deleteCard(id, hub);
      console.log(`Card ${res.deleted.id} deleted.`);
      return 0;
    }

    default: {
      console.error(`Unknown command: ${cmd}. Run 'vega help' for usage.`);
      return 1;
    }
  }
}

// Entrypoint
const isMain =
  Boolean(process.argv[1]) &&
  (resolve(process.argv[1]!) === fileURLToPath(import.meta.url) ||
    basename(process.argv[1]!).startsWith("vega"));

if (isMain) {
  const isCli = process.argv.length > 2 && !["mcp"].includes(process.argv[2]!);
  if (isCli) {
    cli(process.argv.slice(2))
      .then((code) => {
        if (code !== 0) process.exit(code);
      })
      .catch((err) => {
        console.error(errMsg(err));
        process.exit(1);
      });
  } else {
    startMcp().catch((err) => {
      console.error("Failed to start Vega MCP server:", errMsg(err));
      process.exit(1);
    });
  }
}

