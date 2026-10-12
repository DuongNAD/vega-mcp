import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { stateName, stepFsrs } from "./fsrs.js";
import { emptyIngestResult, ingestInbox, inboxSyncLines } from "./inbox.js";
import {
  REVIEW_RATINGS,
  type AuroraCardEvent,
  type InboxIngestResult,
  type ReviewRating,
  type SyncCardUpdate,
  type SyncOptions,
  type SyncResult,
} from "./schema.js";
import {
  appendReviewLog,
  loadCollection,
  loadSyncState,
  readReviewLogs,
  saveCollection,
  saveSyncState,
} from "./store.js";
import { errMsg, hash, localTodayIso, nowIso, parseDate, vegaPaths } from "./util.js";

interface RawCardEventEntry {
  hash: string;
  event: AuroraCardEvent;
}

export async function syncProgress(options: SyncOptions = {}): Promise<SyncResult> {
  // 0. Card inbox first (contract vega-card-inbox.v1): new cards must exist before progress events are applied.
  // A failure here is reported in the summary but never blocks applying the learner's ratings.
  let inbox: InboxIngestResult;
  let inboxError: string | undefined;
  try {
    inbox = await ingestInbox(options.hub);
  } catch (e) {
    inboxError = errMsg(e);
    inbox = emptyIngestResult(options.hub);
  }

  const p = vegaPaths(options.hub);
  const filesToRead: string[] = [];

  // 1. Session progress file
  if (existsSync(p.sessionProgressJsonl)) {
    filesToRead.push(p.sessionProgressJsonl);
  }

  // 2. Explicit progress file
  if (options.file && options.file.trim()) {
    const customFile = options.file.trim();
    if (existsSync(customFile) && !filesToRead.includes(customFile)) {
      filesToRead.push(customFile);
    }
  }

  let malformedLines = 0;
  const rawEntries: RawCardEventEntry[] = [];

  for (const filePath of filesToRead) {
    try {
      const content = await readFile(filePath, "utf8");
      const lines = content.split(/\r?\n/);

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          malformedLines++;
          continue;
        }

        if (typeof parsed !== "object" || parsed === null) {
          malformedLines++;
          continue;
        }

        const obj = parsed as Record<string, unknown>;

        // Non-card events are ignored cleanly without error
        if (obj.type !== "card") {
          continue;
        }

        // Validate card event fields
        const cardId = typeof obj.card === "string" ? obj.card.trim() : "";
        const ratingStr = typeof obj.rating === "string" ? (obj.rating.toLowerCase() as ReviewRating) : null;
        const timeStr = typeof obj.t === "string" ? obj.t.trim() : "";

        if (!cardId || !ratingStr || !REVIEW_RATINGS.includes(ratingStr) || !timeStr) {
          malformedLines++;
          continue;
        }

        const event: AuroraCardEvent = {
          v: typeof obj.v === "number" ? obj.v : 1,
          t: timeStr,
          course: typeof obj.course === "string" ? obj.course : null,
          lesson: typeof obj.lesson === "string" ? obj.lesson : undefined,
          deck: typeof obj.deck === "string" ? obj.deck : undefined,
          slide: typeof obj.slide === "number" ? obj.slide : undefined,
          slideId: typeof obj.slideId === "string" ? obj.slideId : (obj.slideId === null ? null : undefined),
          type: "card",
          card: cardId,
          rating: ratingStr,
          ms: typeof obj.ms === "number" ? obj.ms : undefined,
        };

        const eventHash = hash(`${event.t}_${event.card}_${event.rating}_${event.ms ?? ""}`);
        rawEntries.push({ hash: eventHash, event });
      }
    } catch {
      // File read error
    }
  }

  // 3. Load sync state for idempotency
  const syncState = await loadSyncState(options.hub);
  const processedSet = new Set<string>(syncState.processed_hashes);

  let skippedDuplicates = 0;
  const newEntries: RawCardEventEntry[] = [];

  for (const entry of rawEntries) {
    if (processedSet.has(entry.hash)) {
      skippedDuplicates++;
    } else {
      newEntries.push(entry);
      // Prevent internal duplicate in the same sync batch
      processedSet.add(entry.hash);
    }
  }

  // 4. Sort new events in time order
  newEntries.sort((a, b) => new Date(a.event.t).getTime() - new Date(b.event.t).getTime());

  // 5. Apply reviews to collection
  const collection = await loadCollection(options.hub);
  let reviewsApplied = 0;
  let againCount = 0;
  let reviewLapses = 0;
  let learningAgainCount = 0;
  const skippedUnknown: string[] = [];
  const cardUpdates: SyncCardUpdate[] = [];

  for (const entry of newEntries) {
    const ev = entry.event;
    const card = collection.cards.find((c) => c.id === ev.card);

    if (!card) {
      if (!skippedUnknown.includes(ev.card)) {
        skippedUnknown.push(ev.card);
      }
      continue;
    }

    const reviewDate = parseDate(ev.t);
    const stateBeforeNum = card.fsrs.state;
    const stateBeforeName = stateName(stateBeforeNum);
    const dueBefore = card.fsrs.due;

    const { nextState, elapsedDays, scheduledDays } = stepFsrs(
      card.fsrs,
      ev.rating,
      reviewDate,
      collection.settings,
    );

    card.fsrs = nextState;

    await appendReviewLog(
      {
        t: reviewDate.toISOString(),
        card: card.id,
        rating: ev.rating,
        state_before: stateBeforeNum,
        due_before: dueBefore,
        elapsed_days: elapsedDays,
        ms: ev.ms,
        via: "aurora",
      },
      options.hub,
    );

    const stateAfterName = stateName(card.fsrs.state);
    cardUpdates.push({
      id: card.id,
      rating: ev.rating,
      state_before: stateBeforeName,
      state_after: stateAfterName,
      next_due: card.fsrs.due,
      scheduled_days: scheduledDays,
    });

    reviewsApplied++;
    if (ev.rating === "again") {
      againCount++;
      if (stateBeforeNum === 2) {
        reviewLapses++;
      } else {
        learningAgainCount++;
      }
    }
  }

  // 6. Persist changes
  if (reviewsApplied > 0) {
    await saveCollection(collection, options.hub);
  }

  syncState.last_sync = nowIso();
  syncState.processed_hashes = Array.from(processedSet);
  await saveSyncState(syncState, options.hub);

  // 7. Calculate retention today (review-state reviews only: state_before === 2)
  const allLogs = await readReviewLogs(options.hub);
  const todayStr = localTodayIso();
  const todayLogs = allLogs.filter((l) => l.t.startsWith(todayStr) && l.rating !== "deleted");

  let retentionToday: number | null = null;
  let retentionPercent = "n/a";

  const reviewStateTodayLogs = todayLogs.filter((l) => l.state_before === 2);
  if (reviewStateTodayLogs.length > 0) {
    const passed = reviewStateTodayLogs.filter((l) => l.rating !== "again").length;
    const total = reviewStateTodayLogs.length;
    retentionToday = Number((passed / total).toFixed(4));
    retentionPercent = `${(retentionToday * 100).toFixed(1).replace(/\.0$/, "")}% (${passed}/${total})`;
  } else if (reviewsApplied > 0) {
    const reviewStateApplied = cardUpdates.filter((u) => u.state_before === "Review");
    if (reviewStateApplied.length > 0) {
      const passed = reviewStateApplied.filter((u) => u.rating !== "again").length;
      const total = reviewStateApplied.length;
      retentionToday = Number((passed / total).toFixed(4));
      retentionPercent = `${(retentionToday * 100).toFixed(1).replace(/\.0$/, "")}% (${passed}/${total})`;
    } else {
      retentionToday = null;
      retentionPercent = "n/a";
    }
  }

  // 8. Build summary
  const summary = [
    `Vega Progress Sync Summary:`,
    ...inboxSyncLines(inbox, inboxError),
    `- Reviews applied: ${reviewsApplied}`,
    `- Review lapses: ${reviewLapses}`,
    `- Learning-step again: ${learningAgainCount}`,
    `- Retention today: ${retentionPercent}`,
    `- Skipped (already synced): ${skippedDuplicates}`,
    ...(skippedUnknown.length > 0
      ? [`- Unknown card IDs skipped (${skippedUnknown.length}): ${skippedUnknown.join(", ")}`]
      : []),
    ...(malformedLines > 0 ? [`- Malformed lines skipped: ${malformedLines}`] : []),
  ];

  if (cardUpdates.length > 0) {
    summary.push("", "Updated cards:");
    for (const u of cardUpdates) {
      summary.push(
        `  - [${u.id}] ${u.rating}: ${u.state_before} -> ${u.state_after}, next due in ${u.scheduled_days}d (${u.next_due})`,
      );
    }
  }

  return {
    reviews_applied: reviewsApplied,
    again_count: againCount,
    review_lapses: reviewLapses,
    learning_again_count: learningAgainCount,
    retention_today: retentionToday,
    retention_percent: retentionPercent,
    card_updates: cardUpdates,
    skipped_duplicates: skippedDuplicates,
    skipped_unknown: skippedUnknown,
    malformed_lines: malformedLines,
    inbox,
    ...(inboxError ? { inbox_error: inboxError } : {}),
    summary: summary.join("\n"),
  };
}
