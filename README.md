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
- **Adaptive Intervals:** Easy cards advance rapidly; hard or lapsed cards return sooner.

---

## Principles

1. **The agent writes good cards, Vega schedules them:** Vega proposes candidates from materials; the agent refines them following card rules (one atomic idea per card, cloze for terms, keep memory hooks, Vietnamese learner text).
2. **Proven algorithm:** Uses `ts-fsrs` (v5.4.2, MIT) bundled into a single standalone executable.
3. **Clean storage:** The entire collection resides in `VEGA_HUB/.vega/` (default `D:/02_Learning_Knowledge/.vega/`) with only `cards.json` and `reviews.jsonl` using atomic writes.
4. **Origin fidelity:** Every card preserves its origin (source path and locator such as "slide 12", "fact F1", "station 7") so the learner can trace back to the lesson.

---

## Tools & CLI Reference

### Tools (MCP Server over Stdio)

- `vega_guide { topic? }`: Card-writing rules with Vietnamese examples, FSRS theory, workflows, and origin guide.
- `vega_candidates { path, from?, subject? }`: Deterministic candidate extraction from Polaris `facts.json`, `errorlog.md`, or Aurora `deck.json`.
- `vega_add { cards, hub? }`: Validate, de-duplicate (same origin + front), assign IDs, and initialize FSRS states.
- `vega_edit { id, patch, hub? }`: Edit card front, back, hint, hook, tags, or subject.
- `vega_suspend { id, suspended?, hub? }`: Pause or resume cards from due queues.
- `vega_delete { id, hub? }`: Soft delete a card (removes from active collection and logs to review history).
- `vega_due { subject?, limit?, new_limit?, date?, hub? }`: Today's review queue (overdue first, due today, capped new cards) and 7-day workload forecast.
- `vega_review { id, rating, ms?, date?, via?, hub? }`: Submit review rating (`again`, `hard`, `good`, `easy`) and advance FSRS memory state.
- `vega_stats { subject?, date?, hub? }`: View cards by state, today's reviews, 30-day true retention rate, leech cards (`lapses >= 6`), and workload forecast.

### CLI Usage

```bash
# View today's queue
node dist/vega.mjs due

# Rate a card
node dist/vega.mjs review c_12345 good

# Check statistics
node dist/vega.mjs stats

# Extract candidates from an Aurora deck or Polaris file
node dist/vega.mjs candidates path/to/deck.json

# View documentation
node dist/vega.mjs guide rules
```

---

## Third-Party

- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) (v5.4.2) - MIT License. TypeScript implementation of the Free Spaced Repetition Scheduler algorithm.

---

## License

MIT License (c) 2026 DuongNAD.
