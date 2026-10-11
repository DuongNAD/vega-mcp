import { z } from "zod";

export const CARD_KINDS = ["basic", "cloze", "palace", "reverse"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const ORIGIN_KINDS = [
  "polaris-fact",
  "polaris-errorlog",
  "aurora-notebook",
  "aurora-quiz",
  "aurora-flashcard",
  "aurora-palace",
  "manual",
] as const;
export type OriginKind = (typeof ORIGIN_KINDS)[number];

export const REVIEW_RATINGS = ["again", "hard", "good", "easy"] as const;
export type ReviewRating = (typeof REVIEW_RATINGS)[number];

export const CardOriginSchema = z.strictObject({
  kind: z.enum(ORIGIN_KINDS).describe("Source kind"),
  path: z.string().min(1).describe("File path or locator of source"),
  locator: z.string().optional().describe("Position within source: e.g. 'slide 7', 'fact F12', 'station 2'"),
});
export type CardOrigin = z.output<typeof CardOriginSchema>;

export const FsrsStateSchema = z.strictObject({
  due: z.string().describe("ISO date-time when card is due next"),
  stability: z.number().describe("FSRS memory stability in days"),
  difficulty: z.number().describe("FSRS card difficulty (1..10)"),
  elapsed_days: z.number().describe("Elapsed days since last review"),
  scheduled_days: z.number().describe("Interval in days until next review"),
  reps: z.number().int().min(0).describe("Total number of reviews completed"),
  lapses: z.number().int().min(0).describe("Total number of forgotten reviews (Again)"),
  state: z.number().int().min(0).max(3).describe("0: New, 1: Learning, 2: Review, 3: Relearning"),
  learning_steps: z.number().int().min(0).default(0).describe("Current learning step counter"),
  last_review: z.string().optional().describe("ISO date-time of previous review"),
});
export type FsrsState = z.output<typeof FsrsStateSchema>;

export const CardSchema = z.strictObject({
  id: z.string().min(1).describe("Unique card ID (e.g. c_xxxx)"),
  subject: z.string().min(1).describe("Subject name or slug"),
  deck: z.string().optional().describe("Optional sub-deck or lesson name"),
  kind: z.enum(CARD_KINDS).default("basic").describe("Card kind: basic | cloze | palace | reverse"),
  front: z.string().min(1).describe("Front text / prompt"),
  back: z.string().describe("Back text / answer"),
  hint: z.string().optional().describe("Optional prompt hint"),
  hook: z.string().optional().describe("Memory anchor / hook linking concept to known vivid imagery"),
  origin: CardOriginSchema.describe("Where this card was extracted from"),
  tags: z.array(z.string()).default([]).describe("Categorization tags"),
  created: z.string().describe("ISO date-time when card was created"),
  suspended: z.boolean().optional().describe("Whether this card is paused from due queue"),
  fsrs: FsrsStateSchema.describe("FSRS scheduling state"),
});
export type Card = z.output<typeof CardSchema>;

export const CardInputSchema = z.strictObject({
  subject: z.string().min(1).describe("Subject name or slug"),
  deck: z.string().optional().describe("Sub-deck or lesson name"),
  kind: z.enum(CARD_KINDS).default("basic"),
  front: z.string().min(1).describe("Card front / prompt"),
  back: z.string().describe("Card back / answer"),
  hint: z.string().optional(),
  hook: z.string().optional(),
  origin: CardOriginSchema,
  tags: z.array(z.string()).default([]),
  created: z.string().optional(),
  suspended: z.boolean().optional(),
});
export type CardInput = z.input<typeof CardInputSchema>;

export const CardPatchSchema = z.strictObject({
  front: z.string().min(1).optional(),
  back: z.string().optional(),
  hint: z.string().optional(),
  hook: z.string().optional(),
  tags: z.array(z.string()).optional(),
  subject: z.string().min(1).optional(),
  deck: z.string().optional(),
  suspended: z.boolean().optional(),
});
export type CardPatch = z.output<typeof CardPatchSchema>;

export const CardCandidateSchema = z.strictObject({
  kind: z.enum(CARD_KINDS),
  front: z.string().min(1),
  back: z.string(),
  hint: z.string().optional(),
  hook: z.string().optional(),
  origin: CardOriginSchema,
  tags: z.array(z.string()).default([]),
  subject: z.string().optional(),
  deck: z.string().optional(),
});
export type CardCandidate = z.output<typeof CardCandidateSchema>;

export const ReviewLogEntrySchema = z.object({
  t: z.string().describe("ISO date-time of review"),
  card: z.string().min(1).describe("Card ID"),
  rating: z.union([z.enum(REVIEW_RATINGS), z.literal("deleted")]).describe("Review rating or deleted"),
  state_before: z
    .preprocess((val) => {
      if (typeof val === "string") {
        const s = val.toLowerCase().trim();
        if (s === "new") return 0;
        if (s === "learning") return 1;
        if (s === "review") return 2;
        if (s === "relearning") return 3;
        const n = Number(val);
        if (!isNaN(n)) return n;
      }
      return val;
    }, z.number().int().min(0).max(3).optional())
    .describe("0: New, 1: Learning, 2: Review, 3: Relearning"),
  due_before: z.string().optional(),
  elapsed_days: z.number().optional(),
  ms: z.number().optional().describe("Review response time in milliseconds"),
  via: z.enum(["tool", "aurora"]).default("tool"),
});
export type ReviewLogEntry = z.output<typeof ReviewLogEntrySchema>;

export const VegaSettingsSchema = z.strictObject({
  request_retention: z.number().min(0.7).max(0.99).default(0.9),
  maximum_interval: z.number().int().min(1).default(36500),
  w: z.array(z.number()).optional(),
  enable_fuzz: z.boolean().default(false),
});
export type VegaSettings = z.output<typeof VegaSettingsSchema>;

export const VegaCollectionSchema = z.strictObject({
  version: z.number().int().default(1),
  settings: VegaSettingsSchema.default({
    request_retention: 0.9,
    maximum_interval: 36500,
    enable_fuzz: false,
  }),
  cards: z.array(CardSchema).default([]),
});
export type VegaCollection = z.output<typeof VegaCollectionSchema>;

export interface DueQueueResult {
  date: string;
  queue: Card[];
  counts: {
    overdue: number;
    due: number;
    new: number;
    total: number;
  };
  forecast: Array<{ date: string; count: number }>;
  summary: string;
}

export interface ReviewResult {
  card: Card;
  rating: ReviewRating;
  state_before: string;
  state_after: string;
  next_due: string;
  scheduled_days: number;
  stability: number;
  difficulty: number;
  summary: string;
}

export interface StatsResult {
  total_cards: number;
  by_state: {
    new: number;
    learning: number;
    review: number;
    relearning: number;
    suspended: number;
  };
  reviews_today: number;
  learning_again_today: number;
  true_retention_30d: {
    total_reviews: number;
    passed_reviews: number;
    retention_rate: number | null;
  };
  leeches: Card[];
  forecast_7d: Array<{ date: string; due_count: number }>;
  summary: string;
}

/* ───────── Aurora SRS Slide & Event Schemas ───────── */

export interface SrsSlideOrigin {
  label: string;
  href?: string;
}

export interface SrsSlide {
  type: "srs";
  id?: string;
  card: string;
  front: string;
  back: string;
  hint?: string;
  hook?: string;
  origin?: SrsSlideOrigin;
}

export const AuroraCardEventSchema = z.strictObject({
  v: z.number().int().default(1),
  t: z.string().describe("ISO date-time with offset"),
  course: z.string().nullable().optional(),
  lesson: z.string().optional().describe("Deck folder name, e.g. session"),
  deck: z.string().optional().describe("Deck title"),
  slide: z.number().int().optional(),
  slideId: z.string().nullable().optional(),
  type: z.literal("card"),
  card: z.string().min(1).describe("Vega card ID"),
  rating: z.enum(REVIEW_RATINGS).describe("Rating: again | hard | good | easy"),
  ms: z.number().int().optional().describe("Response time in ms"),
});
export type AuroraCardEvent = z.output<typeof AuroraCardEventSchema>;

export const SyncStateSchema = z.strictObject({
  version: z.number().int().default(1),
  last_sync: z.string().optional(),
  processed_hashes: z.array(z.string()).default([]),
});
export type SyncState = z.output<typeof SyncStateSchema>;

export interface SessionOptions {
  date?: string;
  limit?: number;
  new_limit?: number;
  subject?: string;
  build?: boolean;
  hub?: string;
}

export interface SessionResult {
  date: string;
  deck_path: string;
  session_dir: string;
  card_count: number;
  built: boolean;
  cli_output?: string;
  study_instructions: string;
  summary: string;
}

export interface SyncOptions {
  file?: string;
  hub?: string;
}

export interface SyncCardUpdate {
  id: string;
  rating: ReviewRating;
  state_before: string;
  state_after: string;
  next_due: string;
  scheduled_days: number;
}

export interface SyncResult {
  reviews_applied: number;
  again_count: number;
  review_lapses: number;
  learning_again_count: number;
  retention_today: number | null;
  retention_percent: string;
  card_updates: SyncCardUpdate[];
  skipped_duplicates: number;
  skipped_unknown: string[];
  malformed_lines: number;
  summary: string;
}

