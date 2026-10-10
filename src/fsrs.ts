import {
  createEmptyCard,
  fsrs as createFsrs,
  Rating,
  State,
  type Card as FsrsCard,
  type FSRSParameters,
  type Grade,
} from "ts-fsrs";
import type { FsrsState, ReviewRating, VegaSettings } from "./schema.js";

export { Rating, State };
export type { Grade };

export function ratingFromString(r: ReviewRating): Grade {
  switch (r) {
    case "again":
      return Rating.Again;
    case "hard":
      return Rating.Hard;
    case "good":
      return Rating.Good;
    case "easy":
      return Rating.Easy;
    default:
      throw new Error(`Invalid review rating: ${r}. Must be one of 'again', 'hard', 'good', 'easy'.`);
  }
}

export function ratingToString(r: Rating | Grade): ReviewRating {
  switch (r) {
    case Rating.Again:
      return "again";
    case Rating.Hard:
      return "hard";
    case Rating.Good:
      return "good";
    case Rating.Easy:
      return "easy";
    default:
      return "again";
  }
}

export function stateName(state: number): string {
  switch (state) {
    case State.New:
      return "New";
    case State.Learning:
      return "Learning";
    case State.Review:
      return "Review";
    case State.Relearning:
      return "Relearning";
    default:
      return "Unknown";
  }
}

export function initFsrsState(nowDate: Date = new Date()): FsrsState {
  const empty = createEmptyCard(nowDate);
  return {
    due: empty.due.toISOString(),
    stability: empty.stability,
    difficulty: empty.difficulty,
    elapsed_days: empty.elapsed_days,
    scheduled_days: empty.scheduled_days,
    reps: empty.reps,
    lapses: empty.lapses,
    state: empty.state,
    learning_steps: empty.learning_steps ?? 0,
    last_review: undefined,
  };
}

export function toFsrsCard(s: FsrsState): FsrsCard {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsed_days,
    scheduled_days: s.scheduled_days,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
    learning_steps: s.learning_steps ?? 0,
    last_review: s.last_review ? new Date(s.last_review) : undefined,
  };
}

export function fromFsrsCard(c: FsrsCard, reviewDate?: Date): FsrsState {
  return {
    due: c.due.toISOString(),
    stability: Number(c.stability.toFixed(4)),
    difficulty: Number(c.difficulty.toFixed(4)),
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    learning_steps: c.learning_steps ?? 0,
    last_review: reviewDate ? reviewDate.toISOString() : c.last_review?.toISOString(),
  };
}

export function getFsrsEngine(settings?: VegaSettings) {
  const params: Partial<FSRSParameters> = {
    request_retention: settings?.request_retention ?? 0.9,
    maximum_interval: settings?.maximum_interval ?? 36500,
    enable_fuzz: settings?.enable_fuzz ?? false,
  };
  if (settings?.w && settings.w.length > 0) {
    params.w = settings.w;
  }
  return createFsrs(params);
}

export function stepFsrs(
  currentState: FsrsState,
  rating: ReviewRating,
  reviewDate: Date = new Date(),
  settings?: VegaSettings,
): { nextState: FsrsState; elapsedDays: number; scheduledDays: number } {
  const engine = getFsrsEngine(settings);
  const currentCard = toFsrsCard(currentState);
  const ratingEnum = ratingFromString(rating);

  const result = engine.next(currentCard, reviewDate, ratingEnum);
  const nextState = fromFsrsCard(result.card, reviewDate);

  return {
    nextState,
    elapsedDays: result.log.elapsed_days,
    scheduledDays: result.card.scheduled_days,
  };
}

export function previewFsrsIntervals(
  currentState: FsrsState,
  reviewDate: Date = new Date(),
  settings?: VegaSettings,
): Record<ReviewRating, { due: string; scheduled_days: number; state: string }> {
  const engine = getFsrsEngine(settings);
  const currentCard = toFsrsCard(currentState);
  const repeated = engine.repeat(currentCard, reviewDate);

  return {
    again: {
      due: repeated[Rating.Again].card.due.toISOString(),
      scheduled_days: repeated[Rating.Again].card.scheduled_days,
      state: stateName(repeated[Rating.Again].card.state),
    },
    hard: {
      due: repeated[Rating.Hard].card.due.toISOString(),
      scheduled_days: repeated[Rating.Hard].card.scheduled_days,
      state: stateName(repeated[Rating.Hard].card.state),
    },
    good: {
      due: repeated[Rating.Good].card.due.toISOString(),
      scheduled_days: repeated[Rating.Good].card.scheduled_days,
      state: stateName(repeated[Rating.Good].card.state),
    },
    easy: {
      due: repeated[Rating.Easy].card.due.toISOString(),
      scheduled_days: repeated[Rating.Easy].card.scheduled_days,
      state: stateName(repeated[Rating.Easy].card.state),
    },
  };
}
