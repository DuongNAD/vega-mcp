[Tiếng Việt](README.vi.md) | English

<p align="center"><img src="docs/banner.jpg" alt="Vega MCP — Vega and Altair bridged across the Milky Way" width="100%"></p>

# Vega MCP

*Named after Vega, the Weaver star: Chức Nữ meets Ngưu Lang again at the right time each year, as spaced repetition brings each card back at the right time.*

Vega is the memory engine of the learner's MCP ecosystem: adaptive spaced repetition (FSRS) across every subject, with cards drawn from what the learner already studies (Polaris facts, Aurora notebook pages, quizzes, flashcards, memory palaces, and error logs), daily review queues, and automatic memory state tracking.

Named after the star Vega (sao Chuc Nu), who meets Nguu Lang again at the right time each year.

---

## Ecosystem

All projects by DuongNAD:

| Project | Role | Repository |
| :--- | :--- | :--- |
| **Polaris** | Course architect & syllabus engine | [polaris-mcp](https://github.com/DuongNAD/polaris-mcp) |
| **Aurora Slides** | Lessons & presentation engine | [aurora-slides-mcp](https://github.com/DuongNAD/aurora-slides-mcp) |
| **SmartDrive-OS** | SSD governance & learning search | [smart-drive-os](https://github.com/DuongNAD/smart-drive-os) |
| **Constellation** | MCP registration & ecosystem contracts | [constellation-mcp](https://github.com/DuongNAD/constellation-mcp) |
| **Vega** | Adaptive spaced repetition engine (FSRS) | [vega-mcp](https://github.com/DuongNAD/vega-mcp) |

---

## Why Vega & FSRS?

Traditional spaced repetition systems often use fixed schedules (such as 1, 3, 7, 16, 35 days). In practice, some concepts are trivial while others are deceptively complex.

Vega employs **FSRS (Free Spaced Repetition Scheduler)** via the `ts-fsrs` package:
- **Stability ($S$):** Days required for recall probability to drop to target retention (default 90%).
- **Difficulty ($D$):** Inherent cognitive load on a 1-10 scale.
- **Retrievability ($R$):** Probability of recall at review time.
- **True Retention:** Reports retention strictly according to the FSRS/Anki standard: only reviews of cards in the **Review** state count ($\text{passed} / (\text{passed} + \text{failed})$); learning and relearning steps are excluded so initial learning Agains don't artificially depress retention. Initial Agains are tracked separately as "Learning-step again".
- **Adaptive Intervals:** Easy cards advance rapidly; hard or lapsed cards return sooner.

---

## Principles

1. **The agent writes good cards, Vega schedules them:** Vega proposes candidates from materials; the agent refines them following card rules (one atomic idea per card, cloze for terms, keep memory hooks, Vietnamese learner text).
2. **Proven algorithm:** Uses `ts-fsrs` (v5.4.2, MIT) bundled into a single standalone executable.
3. **Clean storage:** The entire collection resides in `VEGA_HUB/.vega/` (default `D:/02_Learning_Knowledge/.vega/`) with only `cards.json`, `reviews.jsonl`, `sync-state.json`, the fixed `session/` folder, and the `inbox/` drop folder (with `done/` and `rejected/`) using atomic writes.
4. **Origin fidelity & Lesson links:** Every card preserves its origin (source path and locator such as "slide 12", "fact F1", "station 7") and calculates relative links back to the original lesson deck.

---

## Aurora Slides Integration & Review Sessions

Vega turns daily spaced-repetition queues into interactive **Aurora Slides** review decks:

1. **Daily Session Deck (`vega_session`):** Generates `<hub>/.vega/session/deck.json` containing a Title slide with subject breakdown, interactive `srs` slides for each card, and a closing Summary slide. The single `session/` directory is reused every day to prevent cluster waste on exFAT drives.
2. **Aurora `srs` Slides:** Flip with `Space`/`Enter`, rate recall using keys `1` (Again), `2` (Hard), `3` (Good), `4` (Easy), and jump to source lessons via relative origin links.
3. **Progress Events (`progress.jsonl`):** Interactive reviews emit `"card"` events:
   ```json
   {"v":1, "t":"2026-10-11T09:00:00+07:00", "course":null, "lesson":"session", "deck":"Ôn tập hôm nay", "slide":2, "type":"card", "card":"c_12345", "rating":"good", "ms":3200}
   ```
4. **Automatic Idempotent Sync (`vega_sync`):** Synchronizes progress events into FSRS memory states in chronological order, recording event hashes in `sync-state.json` to prevent duplicates.

---

## One Review Queue: the Card Inbox

Every producer of review items in the ecosystem (Polaris error log and lesson self-checks, Orion repeated failures, Mira missed prediction stops, future Aurora exports) drops card candidates into Vega's inbox instead of scheduling reviews of its own. Evidence favours one adaptive spacing scheduler over several fixed ones (Latimier, Peyre and Ramus 2021, [doi:10.1007/s10648-020-09572-8](https://doi.org/10.1007/s10648-020-09572-8); Lindsey et al. 2014, [doi:10.1177/0956797613504302](https://doi.org/10.1177/0956797613504302)), and two schedulers create review debt (the second point is an engineering argument, not a finding of those papers). So Vega alone validates, de-duplicates and schedules the items with FSRS. Producers never write `cards.json` or `reviews.jsonl`.

Contract `vega-card-inbox.v1`:

- **Files:** `<hub>/.vega/inbox/<producer>-<YYYYMMDDTHHmmss>-<6 hex>.jsonl`, one new file per batch, UTF-8, one JSON object per line, written atomically (`<name>.jsonl.tmp`, then rename). `*.tmp` files, subfolders and files that are not `.jsonl` are ignored.
- **Line:** `{v: 1, t, producer, key, subject, deck?, kind?, front, back, hint?, hook?, origin: {kind, path, locator?, href?}, tags?, reason?}`. Unknown fields are rejected. `key` is the stable dedupe key and must start with `<producer>:` (for example `polaris:Machine_Learning:ERR_2026-10-12_ab12cd`, `orion:Lab_1:check_sum`, `mira:vong-lap-for:stop-3`). `origin.href` becomes a clickable link in the lesson page, so `javascript:`, `data:` and `vbscript:` links are refused.
- **Ingestion** (first step of `vega_sync`, or `vega_inbox { action: "ingest" }`): files are processed in name order; each line is validated strictly; a key that already exists (active, suspended or soft-deleted card) is skipped as a duplicate; every other valid line becomes a New FSRS card (`created` = the line's `t`). Processed files move to `inbox/done/`; invalid lines, with an added `_error` field, go to `inbox/rejected/<same name>`. Ingestion is idempotent, so running it again changes nothing.
- **Preview:** `vega_inbox { action: "list" }` shows pending files, line counts and a validation preview, and writes nothing.
- **Session decks:** when a card's origin has `href`, its `srs` slide gets `origin: {label, href}` with a short Vietnamese label such as `Mira · điểm dừng 3`, `Sổ lỗi · ERR_2026-10-12_ab12cd` or `Orion · <check>`.
- **Soft delete:** `vega_delete` stores the card's `key` on its "deleted" line in `reviews.jsonl`, so a producer re-sending a card the learner deleted does not bring it back.

Read the full rules with `vega_guide { topic: "inbox" }`.

---

## Tools, Prompts & CLI Reference

### Tools (MCP Server over Stdio)

- `vega_guide { topic? }`: Card-writing rules with Vietnamese examples, FSRS theory, workflows, session integration, origin guide, collection stats, and the card inbox (`overview`, `rules`, `fsrs`, `workflows`, `candidates`, `origins`, `session`, `stats`, `inbox`).
- `vega_candidates { path, from?, subject? }`: Deterministic candidate extraction from Polaris `facts.json`, `errorlog.md`, or Aurora `deck.json`.
- `vega_add { cards, hub? }`: Validate, de-duplicate (same origin + front, or same optional `key`), assign IDs, and initialize FSRS states. Cards may carry `key` and `origin.href`.
- `vega_inbox { action: "list" | "ingest", hub? }`: Preview (no writes) or ingest the card inbox; reports files read, cards created, duplicates and rejected lines with reasons (Vietnamese).
- `vega_edit { id, patch, hub? }`: Edit card front, back, hint, hook, tags, or subject.
- `vega_suspend { id, suspended?, hub? }`: Pause or resume cards from due queues.
- `vega_delete { id, hub? }`: Soft delete a card (removes from active collection and logs to review history, with the card key if it has one).
- `vega_due { subject?, limit?, new_limit?, date?, hub? }`: Today's review queue (overdue first, due today, capped new cards) and 7-day workload forecast.
- `vega_session { date?, limit?, new_limit?, subject?, build?, hub? }`: Generate today's review session deck into `.vega/session/` and build with Aurora CLI.
- `vega_sync { file?, hub? }`: Ingest the card inbox first (its counts are in the reply), then synchronize review ratings from `.vega/session/progress.jsonl` or exported progress file into FSRS idempotently.
- `vega_review { id, rating, ms?, date?, via?, hub? }`: Submit review rating (`again`, `hard`, `good`, `easy`) and advance FSRS memory state.
- `vega_stats { subject?, date?, hub? }`: View cards by state, today's reviews, learning-step agains, 30-day true retention rate (review-state only), leech cards (`lapses >= 6`), and workload forecast.

### Prompts

- `review_today { date?, subject?, hub? }`: Guided daily review workflow (`vega_sync` -> `vega_session` -> interactive study -> `vega_sync`).
- `make_cards { path, subject?, hub? }`: Standardized card authoring workflow (`vega_candidates` -> 6 card rules rewrite -> `vega_add`).

### CLI Usage

```bash
# Generate today's review session deck
node dist/vega.mjs session

# Ingest the card inbox, then sync ratings from Aurora session progress into FSRS
node dist/vega.mjs sync

# Preview the card inbox (no writes) / ingest it (add --json for machine-readable output)
node dist/vega.mjs inbox list
node dist/vega.mjs inbox ingest

# View today's queue
node dist/vega.mjs due

# Rate a card directly
node dist/vega.mjs review c_12345 good

# Check statistics & true retention
node dist/vega.mjs stats

# Extract candidates from an Aurora deck or Polaris file
node dist/vega.mjs candidates path/to/deck.json

# View documentation
node dist/vega.mjs guide stats
```

---

## Version History

- **v0.3.0**: Vega becomes the single review queue of the MCP ecosystem. Shared card-inbox contract `vega-card-inbox.v1`: producers (Polaris, Orion, Mira, ...) drop `*.jsonl` card candidates into `<hub>/.vega/inbox/`; Vega validates strictly, de-duplicates by `key` (active, suspended and soft-deleted cards), creates New FSRS cards, moves processed files to `inbox/done/` and writes rejected lines with `_error` to `inbox/rejected/`, idempotently. New tool `vega_inbox { action: "list" | "ingest" }` and CLI `vega inbox list|ingest`; `vega_sync` ingests the inbox first and reports its counts. Cards gain an optional unique `key`; origins gain `href` and the kinds `polaris-selfcheck`, `aurora-predict`, `orion-attempt`, `mira-stop`; `vega_delete` keeps the key on its log line. Session `srs` slides carry `origin: {label, href}` for cards with an origin `href`. Guide topic `inbox`. Old `cards.json` files load unchanged. e2e: the `due` CLI check now pins `--date 2026-10-11` (it compared a hard-coded date with the real clock).
- **v0.2.2**: Specific card fronts and KaTeX math delimiters for Aurora notebook slides (formulas get `$$...$$` delimiters for display KaTeX rendering in Aurora review sessions; fronts wrap formula LHS in `$...$`; multi-formula lines separated by `\quad`, `\qquad`, or `;` yield one card per formula; rules and hooks use "Quy tắc cốt lõi · <sub-heading>" / "Mỏ neo trí nhớ · <sub-heading>"; deck-level deduplication ensures unique fronts across all cards in a deck); guide card rules updated with KaTeX math delimiters and specific fronts guidance.
- **v0.2.1**: True retention reporting aligned with FSRS / Anki standard: only reviews of cards in Review state count towards retention (`passed / (passed + failed)`); learning and relearning steps are excluded; separate counter for learning-step agains in `vega_stats` and `vega_sync`; guide topic `stats`; backward-compatible parsing and derivation for legacy review logs without stored states.
- **v0.2.0**: Integrated Aurora Slides SRS review sessions (`vega_session`), automated idempotent sync from `progress.jsonl` (`vega_sync`), fixed `.vega/session/` directory reuse, prompts `review_today` and `make_cards`.
- **v0.1.0**: Initial release with 9 MCP tools, FSRS scheduling via `ts-fsrs`, deterministic candidate extraction from Polaris facts/error logs and Aurora decks, atomic persistence in `.vega/`.

---

## Third-Party

- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) (v5.4.2) - MIT License. TypeScript implementation of the Free Spaced Repetition Scheduler algorithm.

---

## License

MIT License (c) 2026 DuongNAD.
