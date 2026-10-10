import {
  CardSchema,
  type Card,
  type DueQueueResult,
  type StatsResult,
  type VegaCollection,
} from "./schema.js";
import { loadCollection, readReviewLogs } from "./store.js";
import {
  addDays,
  endOfDay,
  localTodayIso,
  parseDate,
  startOfDay,
} from "./util.js";

export interface DueQueueOptions {
  subject?: string;
  limit?: number;
  new_limit?: number;
  date?: string;
  hub?: string;
}

export async function getDueQueue(options: DueQueueOptions = {}): Promise<DueQueueResult> {
  const collection = await loadCollection(options.hub);
  const targetDate = options.date ? parseDate(options.date) : new Date();
  const dateStr = localTodayIso(targetDate);
  const start = startOfDay(targetDate);
  const end = endOfDay(targetDate);
  const totalLimit = options.limit ?? 100;
  const newLimit = options.new_limit ?? 10;

  let cards = collection.cards.filter((c) => !c.suspended);
  if (options.subject && options.subject.trim()) {
    const sub = options.subject.trim().toLowerCase();
    cards = cards.filter((c) => c.subject.toLowerCase() === sub);
  }

  const overdueCards: Card[] = [];
  const dueTodayCards: Card[] = [];
  const newCards: Card[] = [];

  for (const card of cards) {
    if (card.fsrs.state === 0) {
      newCards.push(card);
    } else {
      const dueDate = new Date(card.fsrs.due);
      if (dueDate < start) {
        overdueCards.push(card);
      } else if (dueDate <= end) {
        dueTodayCards.push(card);
      }
    }
  }

  // Sort overdue cards: earliest due first
  overdueCards.sort((a, b) => new Date(a.fsrs.due).getTime() - new Date(b.fsrs.due).getTime());

  // Sort due today cards: earliest due first
  dueTodayCards.sort((a, b) => new Date(a.fsrs.due).getTime() - new Date(b.fsrs.due).getTime());

  // Sort new cards: earliest created first
  newCards.sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());

  const selectedNew = newCards.slice(0, newLimit);
  const fullQueue = [...overdueCards, ...dueTodayCards, ...selectedNew].slice(0, totalLimit);

  // 7-day workload forecast
  const forecast: Array<{ date: string; count: number }> = [];
  for (let i = 1; i <= 7; i++) {
    const fDateStr = addDays(targetDate, i);
    const fStart = startOfDay(fDateStr);
    const fEnd = endOfDay(fDateStr);
    const dueCount = cards.filter((c) => {
      if (c.fsrs.state === 0) return false;
      const d = new Date(c.fsrs.due);
      return d >= fStart && d <= fEnd;
    }).length;
    forecast.push({ date: fDateStr, count: dueCount });
  }

  const summary = [
    `Vega Due Queue for ${dateStr}${options.subject ? ` (Subject: ${options.subject})` : ""}:`,
    `- Total in queue: ${fullQueue.length} (${overdueCards.length} overdue, ${dueTodayCards.length} due today, ${selectedNew.length} new)`,
    `- Remaining new cards available: ${Math.max(0, newCards.length - selectedNew.length)}`,
    `- 7-day forecast: ${forecast.map((f) => `${f.date}: ${f.count}`).join(" | ")}`,
  ].join("\n");

  return {
    date: dateStr,
    queue: fullQueue,
    counts: {
      overdue: overdueCards.length,
      due: dueTodayCards.length,
      new: selectedNew.length,
      total: fullQueue.length,
    },
    forecast,
    summary,
  };
}

export interface StatsOptions {
  subject?: string;
  date?: string;
  hub?: string;
}

export async function getStats(options: StatsOptions = {}): Promise<StatsResult> {
  const collection = await loadCollection(options.hub);
  const reviewLogs = await readReviewLogs(options.hub);
  const targetDate = options.date ? parseDate(options.date) : new Date();
  const dateStr = localTodayIso(targetDate);

  let cards = collection.cards;
  if (options.subject && options.subject.trim()) {
    const sub = options.subject.trim().toLowerCase();
    cards = cards.filter((c) => c.subject.toLowerCase() === sub);
  }

  const byState = {
    new: 0,
    learning: 0,
    review: 0,
    relearning: 0,
    suspended: 0,
  };

  const leeches: Card[] = [];

  for (const c of cards) {
    if (c.suspended) {
      byState.suspended++;
    } else {
      if (c.fsrs.state === 0) byState.new++;
      else if (c.fsrs.state === 1) byState.learning++;
      else if (c.fsrs.state === 2) byState.review++;
      else if (c.fsrs.state === 3) byState.relearning++;
    }

    if (c.fsrs.lapses >= 6) {
      leeches.push(c);
    }
  }

  // Reviews today
  const reviewsToday = reviewLogs.filter(
    (l) => l.t.startsWith(dateStr) && l.rating !== "deleted",
  ).length;

  // True retention over the last 30 days
  const thirtyDaysAgo = new Date(targetDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  const endTarget = endOfDay(targetDate);

  const relevantLogs = reviewLogs.filter((l) => {
    if (l.rating === "deleted") return false;
    const t = new Date(l.t);
    return t >= thirtyDaysAgo && t <= endTarget;
  });

  const totalReviews30d = relevantLogs.length;
  const passedReviews30d = relevantLogs.filter((l) => l.rating !== "again").length;
  const retentionRate =
    totalReviews30d > 0 ? Number((passedReviews30d / totalReviews30d).toFixed(4)) : null;

  // 7-day workload forecast
  const forecast7d: Array<{ date: string; due_count: number }> = [];
  for (let i = 1; i <= 7; i++) {
    const fDateStr = addDays(targetDate, i);
    const fStart = startOfDay(fDateStr);
    const fEnd = endOfDay(fDateStr);
    const dueCount = cards.filter((c) => {
      if (c.suspended || c.fsrs.state === 0) return false;
      const d = new Date(c.fsrs.due);
      return d >= fStart && d <= fEnd;
    }).length;
    forecast7d.push({ date: fDateStr, due_count: dueCount });
  }

  const retentionPercent = retentionRate !== null ? `${(retentionRate * 100).toFixed(1)}%` : "N/A (no reviews)";
  const summary = [
    `Vega Memory Collection Stats (${dateStr})${options.subject ? ` - Subject: ${options.subject}` : ""}:`,
    `- Total Cards: ${cards.length}`,
    `- By State: New (${byState.new}), Learning (${byState.learning}), Review (${byState.review}), Relearning (${byState.relearning}), Suspended (${byState.suspended})`,
    `- Reviews Today: ${reviewsToday}`,
    `- 30-Day True Retention: ${retentionPercent} (${passedReviews30d}/${totalReviews30d} reviews)`,
    `- Leech Cards (lapses >= 6): ${leeches.length}`,
    `- Workload (next 7 days): ${forecast7d.map((f) => `${f.date}: ${f.due_count}`).join(" | ")}`,
  ].join("\n");

  return {
    total_cards: cards.length,
    by_state: byState,
    reviews_today: reviewsToday,
    true_retention_30d: {
      total_reviews: totalReviews30d,
      passed_reviews: passedReviews30d,
      retention_rate: retentionRate,
    },
    leeches,
    forecast_7d: forecast7d,
    summary,
  };
}
