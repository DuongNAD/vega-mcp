# Vega MCP - plan and design

Vega is the memory engine of the learner's MCP ecosystem: adaptive spaced repetition (FSRS) across every subject,
with cards drawn from what the learner already studies (Polaris facts, Aurora notebook pages, quizzes, flashcards and
memory palaces, the error log), daily review sessions rendered as Aurora lessons, and ratings that flow back
automatically. Named after the star Vega (sao Chức Nữ), who meets Ngưu Lang again at the right time each year.

Ecosystem (all by DuongNAD): Polaris (course architect, https://github.com/DuongNAD/polaris-mcp), Aurora Slides
(lessons and progress events, https://github.com/DuongNAD/aurora-slides-mcp), SmartDrive-OS (SSD governance and
learning search, https://github.com/DuongNAD/smart-drive-os), Constellation (registration, health, shared contracts,
https://github.com/DuongNAD/constellation-mcp), Vega (this project).

## Why
Polaris schedules reviews on fixed intervals (1, 3, 7, 16, 35 days) per lesson and per error-log entry. Memory
research and FSRS (the scheduler used by Anki since 23.10) schedule each card from its own memory state (difficulty,
stability, retrievability), so easy cards come back rarely and hard ones often, at a chosen target retention. The
learner studies with memory anchors and recall walks; Vega turns those anchors into cards and keeps them alive.

## Principles
1. The agent writes good cards, Vega schedules them. Vega proposes candidates from the learner's materials; the agent
   rewrites them following card-writing rules (one idea per card, cloze for terms, no unordered lists to recite, keep
   the memory hook, Vietnamese learner text) and the learner can veto.
2. Proven algorithm, not a home-made one: FSRS through the `ts-fsrs` package (v5.4.2, MIT), bundled into the single dist file;
   default parameters and a desired retention of 0.9 (configurable); the optimizer is a later phase.
3. Few files: the collection lives in one folder (default <hub>/.vega/, hub = VEGA_HUB or D:/02_Learning_Knowledge):
   cards.json (cards and their FSRS state) and reviews.jsonl (append-only review log); atomic writes; no micro-files
   on the exFAT drive. Producers (Polaris, Orion, Mira, Rigel) never write these two files: they drop `*.jsonl` batches into
   `<hub>/.vega/inbox/` (contract `vega-card-inbox.v1`) and only Vega ingests them, so there is one review queue.
4. Evidence and links: every card keeps its origin (subject, source file, locator such as "slide 7", fact F12,
   "p. 3", palace station) so the learner can jump back to the lesson.
5. Same toolchain discipline as the sister projects: TypeScript, esbuild bundle dist/vega.mjs, toolchain outside the
   project (VEGA_TOOLCHAIN, falling back to the Aurora toolchain; ts-fsrs is installed into that toolchain on C:,
   never into the project), no node_modules on D:, no recursive scans of D:.

## Data
Card: `{id, subject, deck?, kind: basic | cloze | palace | reverse, front, back, hint?, hook? (memory anchor),
origin: {kind: polaris-fact | polaris-errorlog | polaris-selfcheck | aurora-notebook | aurora-quiz | aurora-flashcard |
aurora-palace | aurora-predict | orion-attempt | mira-stop | rigel-ref | manual, path, locator?, href?}, tags, created, suspended?,
key? (stable dedupe key from a producer, 1-200 chars, unique across the collection when present), fsrs: {due,
stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review, learning_steps}}`.
Review log line: `{t, card, rating: again | hard | good | easy | deleted, state_before, due_before, elapsed_days, ms?,
via: tool | aurora, key? (only on "deleted" lines, so the inbox still recognizes a soft-deleted card)}`.
Inbox line (contract `vega-card-inbox.v1`, strict, unknown fields rejected): `{v: 1, t, producer: polaris | orion |
mira | aurora | sirius | rigel | manual, key (starts with "<producer>:"), subject, deck?, kind?: basic | cloze | reverse, front
(1-600), back (0-1200), hint?, hook?, origin: {kind, path, locator?, href?}, tags? (<= 10), reason?}`; `reason` is
validated and shown in the ingest report but not stored on the card. `origin.href` is a clickable link in the lesson
page, so `javascript:`, `data:` and `vbscript:` links are refused (stricter than the contract, which only caps the length).
Amendment 2026-10-13 (v0.3.1, backward compatible, still v1): producer `rigel` (Rigel, grounded Q&A over the learner's
lesson materials; key `rigel:<subject or course>:<ref>:<first 8 hex of sha1(front)>`) and origin kind `rigel-ref` (a
citable chunk of a lesson file: `path` = absolute source file, `locator` = `<ref> · <slide/page/section>`, `href`
optional). Session label of a rigel-ref card: `Tài liệu · <locator>`.

## Tools (v0.1) and CLI
- `vega_guide {topic?}`: card-writing rules (with examples in Vietnamese), FSRS in plain words, workflows.
- `vega_candidates {from, path}`: deterministic extraction of card candidates (never saved): Polaris facts.json
  (claims -> basic or cloze), Polaris errorlog.md (the corrected rule -> basic), Aurora deck.json notebook lines
  (`term: def` -> basic + reverse; formulas -> basic), quiz items (question -> correct answer with explanation),
  flashcards (front/back), palace stations (place -> item, with the hook). Each candidate carries its origin.
- `vega_add {cards}`: validate, de-duplicate (same origin + same front), assign ids, initialize FSRS state.
- `vega_edit {id, patch}`, `vega_suspend {id}`, `vega_delete {id}` (soft delete into the log).
- `vega_due {subject?, limit?, date?}`: today's queue (overdue first, then due, then a capped number of new cards per
  day, default 10 new / 100 reviews), with the forecast for the next 7 days.
- `vega_review {id, rating, ms?}`: rate one card (for review in chat) and return the next interval.
- `vega_stats {subject?}`: cards by state, reviews today, true retention over the last 30 days, leeches (lapses >= 6),
  workload forecast.
- CLI mirrors the tools (`due`, `review`, `stats`, `candidates`, `add`, `guide`, `version`, `help`, `--json`).
v0.2 (with Aurora and Constellation): an Aurora `srs` slide (front, flip, ratings Again/Hard/Good/Easy on keys 1-4)
emitting a new progress event type "card" (contract update in Constellation), `vega_session` (write today's queue as
an Aurora review deck), `vega_sync` (apply "card" events from Aurora progress.jsonl idempotently), Polaris
`polaris_today` showing the Vega queue, error-log entries offered as cards automatically.
v0.3.0 (card inbox, the single review queue): `vega_inbox {action: list | ingest, hub?}` (list = pending files, line
counts and validation preview without writing; ingest = validate, de-duplicate by key against active, suspended and
soft-deleted cards, create New cards, move processed files to `inbox/done/`, write rejected lines with `_error` to
`inbox/rejected/<same name>`; idempotent), `vega_sync` ingests the inbox first and reports its counts, CLI
`vega inbox list|ingest [--json]`, session `srs` slides get `origin: {label, href}` when the card origin has `href`,
guide topic `inbox`. v0.3.1 (contract amendment 2026-10-13): the inbox validator, the card origin kinds and the `vega_add`
input accept the producer `rigel` and the origin kind `rigel-ref`; session label `Tài liệu · <locator>`; guide topics
`inbox` and `origins` list them. Later: FSRS parameter optimization from the review log; Anki export (.apkg) and import.

## Tests (e2e with the MCP SDK client, collection under %TEMP%)
FSRS behaviour against ts-fsrs for a fixed card and fixed dates (intervals after again/hard/good/easy); candidates
from fixture Polaris and Aurora files with origins; de-duplication; due ordering and daily limits with a fixed date;
review updates state and appends the log; stats on a fixture log; atomic writes; no file outside the collection
folder is written. Inbox: a valid file ingested (cards with key, origin href, state New), duplicate key skipped (also
against a suspended and a soft-deleted card), invalid lines rejected with reasons into `rejected/`, unknown field
rejected, processed file moved to `done/`, `.tmp` ignored, second ingest a no-op, `vega_sync` ingests and reports
counts, `vega_due` shows ingested New cards within the new-card limit, session slides carry origin href and label, an
old `cards.json` without the new fields loads unchanged, `vega_inbox list` makes no writes. Rigel producer (v0.3.1): a
valid rigel line ingested with its key and origin, a rigel line with a wrong key prefix or an origin kind outside the
enum rejected into `rejected/`, `vega_add` accepts `rigel-ref`, session slide label `Tài liệu · <locator>`, guide topics.

## Status
- 2026-10-11: v0.1 built and tested (9 tools, CLI, FSRS with ts-fsrs@5.4.2, deterministic candidate extraction with origins, atomic writes, e2e passing).
- 2026-10-11: v0.2.0 complete (11 tools: added `vega_session` and `vega_sync`; prompts `review_today` and `make_cards`; guide topic `session`; daily review sessions generated into fixed `<collection>/session/` folder as Aurora decks with `srs` slides, origin lesson href links, and automatic idempotent sync from `progress.jsonl` into FSRS; CLI `session` and `sync` commands; e2e test suite passing).
- 2026-10-11: v0.2.1 complete (FSRS True Retention reporting: true retention strictly calculated over review-state reviews only, excluding learning and relearning steps; separate counter for learning-step agains today in `vega_stats` and `vega_sync`; backward-compatible review log parsing and derivation for lines without stored states; guide topic `stats`; e2e tests passing).
- 2026-10-11: v0.2.2 complete (Specific candidate card fronts and KaTeX math delimiters for Aurora notebook pages: formula cards use `$$...$$` delimiters for display KaTeX rendering in Aurora review sessions; fronts wrap LHS in `$...$`; multi-formula lines separated by `\quad`, `\qquad`, or `;` split into atomic cards holding one formula each; rule `! ` and hook `@ ` lines use "Quy tắc cốt lõi · <sub-heading>" / "Mỏ neo trí nhớ · <sub-heading>"; deck-level candidate deduplication ensures no duplicate fronts; updated guide card rules; e2e tests passing).
- 2026-10-12: v0.3.0 complete (Vega is the single review queue: shared card-inbox contract `vega-card-inbox.v1`; 12 tools, new `vega_inbox { action: "list" | "ingest" }` and CLI `vega inbox list|ingest`; `vega_sync` ingests the inbox first and reports counts; cards gain optional unique `key`, origins gain `href` and the kinds `polaris-selfcheck`, `aurora-predict`, `orion-attempt`, `mira-stop`; `vega_delete` stores the key on its "deleted" log line so soft-deleted cards are never re-created; session `srs` slides carry `origin: {label, href}` for cards with an origin `href`; guide topic `inbox` with the evidence for one adaptive queue; old `cards.json` loads unchanged; e2e 207 checks passing (baseline 83); test fix: the e2e `due` CLI check compared a hard-coded date with the real clock and failed on every day except 2026-10-11, it now passes `--date 2026-10-11`).
- 2026-10-13: v0.3.1 complete (contract amendment 2026-10-13 for `vega-card-inbox.v1`, backward compatible: producer `rigel` and origin kind `rigel-ref` accepted by the inbox validator, the card origin kinds and the `vega_add` input; session label `Tài liệu · <locator>` for rigel-ref cards, with or without `href`; guide topics `inbox` and `origins` list the Rigel producer; version 0.3.1 in package.json, VERSION and the e2e version checks; e2e 231 checks passing (207 before), 0 FAIL).
