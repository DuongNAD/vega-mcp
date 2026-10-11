[Tiếng Việt](README.vi.md) | English

# Vega MCP

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
3. **Clean storage:** The entire collection resides in `VEGA_HUB/.vega/` (default `D:/02_Learning_Knowledge/.vega/`) with only `cards.json`, `reviews.jsonl`, `sync-state.json`, and the fixed `session/` folder using atomic writes.
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

## Tools, Prompts & CLI Reference

### Tools (MCP Server over Stdio)

- `vega_guide { topic? }`: Card-writing rules with Vietnamese examples, FSRS theory, workflows, session integration, origin guide, and collection stats (`overview`, `rules`, `fsrs`, `workflows`, `candidates`, `origins`, `session`, `stats`).
- `vega_candidates { path, from?, subject? }`: Deterministic candidate extraction from Polaris `facts.json`, `errorlog.md`, or Aurora `deck.json`.
- `vega_add { cards, hub? }`: Validate, de-duplicate (same origin + front), assign IDs, and initialize FSRS states.
- `vega_edit { id, patch, hub? }`: Edit card front, back, hint, hook, tags, or subject.
- `vega_suspend { id, suspended?, hub? }`: Pause or resume cards from due queues.
- `vega_delete { id, hub? }`: Soft delete a card (removes from active collection and logs to review history).
- `vega_due { subject?, limit?, new_limit?, date?, hub? }`: Today's review queue (overdue first, due today, capped new cards) and 7-day workload forecast.
- `vega_session { date?, limit?, new_limit?, subject?, build?, hub? }`: Generate today's review session deck into `.vega/session/` and build with Aurora CLI.
- `vega_sync { file?, hub? }`: Synchronize review ratings from `.vega/session/progress.jsonl` or exported progress file into FSRS idempotently.
- `vega_review { id, rating, ms?, date?, via?, hub? }`: Submit review rating (`again`, `hard`, `good`, `easy`) and advance FSRS memory state.
- `vega_stats { subject?, date?, hub? }`: View cards by state, today's reviews, learning-step agains, 30-day true retention rate (review-state only), leech cards (`lapses >= 6`), and workload forecast.

### Prompts

- `review_today { date?, subject?, hub? }`: Guided daily review workflow (`vega_sync` -> `vega_session` -> interactive study -> `vega_sync`).
- `make_cards { path, subject?, hub? }`: Standardized card authoring workflow (`vega_candidates` -> 6 card rules rewrite -> `vega_add`).

### CLI Usage

```bash
# Generate today's review session deck
node dist/vega.mjs session

# Sync ratings from Aurora session progress into FSRS
node dist/vega.mjs sync

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
