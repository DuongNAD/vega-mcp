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
   on the exFAT drive.
4. Evidence and links: every card keeps its origin (subject, source file, locator such as "slide 7", fact F12,
   "p. 3", palace station) so the learner can jump back to the lesson.
5. Same toolchain discipline as the sister projects: TypeScript, esbuild bundle dist/vega.mjs, toolchain outside the
   project (VEGA_TOOLCHAIN, falling back to the Aurora toolchain; ts-fsrs is installed into that toolchain on C:,
   never into the project), no node_modules on D:, no recursive scans of D:.

## Data
Card: `{id, subject, deck?, kind: basic | cloze | palace | reverse, front, back, hint?, hook? (memory anchor),
origin: {kind: polaris-fact | polaris-errorlog | aurora-notebook | aurora-quiz | aurora-flashcard | aurora-palace |
manual, path, locator?}, tags, created, suspended?, fsrs: {due, stability, difficulty, elapsed_days, scheduled_days,
reps, lapses, state, last_review, learning_steps}}`.
Review log line: `{t, card, rating: again | hard | good | easy, state_before, due_before, elapsed_days, ms?, via:
tool | aurora}`.

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
`polaris_today` showing the Vega queue, error-log entries offered as cards automatically. v0.3: FSRS parameter
optimization from the review log; Anki export (.apkg) and import.

## Tests (e2e with the MCP SDK client, collection under %TEMP%)
FSRS behaviour against ts-fsrs for a fixed card and fixed dates (intervals after again/hard/good/easy); candidates
from fixture Polaris and Aurora files with origins; de-duplication; due ordering and daily limits with a fixed date;
review updates state and appends the log; stats on a fixture log; atomic writes; no file outside the collection
folder is written.

## Status
- 2026-10-11: v0.1 built and tested (9 tools, CLI, FSRS with ts-fsrs@5.4.2, deterministic candidate extraction with origins, atomic writes, e2e passing).
- 2026-10-11: v0.2.0 complete (11 tools: added `vega_session` and `vega_sync`; prompts `review_today` and `make_cards`; guide topic `session`; daily review sessions generated into fixed `<collection>/session/` folder as Aurora decks with `srs` slides, origin lesson href links, and automatic idempotent sync from `progress.jsonl` into FSRS; CLI `session` and `sync` commands; e2e test suite passing).
