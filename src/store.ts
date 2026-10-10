import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { initFsrsState } from "./fsrs.js";
import {
  CardInputSchema,
  CardPatchSchema,
  CardSchema,
  ReviewLogEntrySchema,
  VegaCollectionSchema,
  type Card,
  type CardInput,
  type CardPatch,
  type ReviewLogEntry,
  type VegaCollection,
} from "./schema.js";
import {
  atomicAppendFile,
  atomicWriteFile,
  generateCardId,
  nowIso,
  readJson,
  vegaPaths,
  writeJson,
} from "./util.js";

export async function loadCollection(hub?: string): Promise<VegaCollection> {
  const p = vegaPaths(hub);
  const data = await readJson<unknown>(p.cardsJson);
  if (!data) {
    const defaultCollection: VegaCollection = {
      version: 1,
      settings: {
        request_retention: 0.9,
        maximum_interval: 36500,
        enable_fuzz: false,
      },
      cards: [],
    };
    return defaultCollection;
  }

  // Support array format or full collection format
  if (Array.isArray(data)) {
    return {
      version: 1,
      settings: {
        request_retention: 0.9,
        maximum_interval: 36500,
        enable_fuzz: false,
      },
      cards: data.map((c) => CardSchema.parse(c)),
    };
  }

  const parsed = VegaCollectionSchema.safeParse(data);
  if (parsed.success) {
    return parsed.data;
  }

  // Gracefully recover cards if schema mismatch
  const obj = data as { cards?: unknown[]; version?: number; settings?: unknown };
  return {
    version: obj.version ?? 1,
    settings: {
      request_retention: 0.9,
      maximum_interval: 36500,
      enable_fuzz: false,
    },
    cards: Array.isArray(obj.cards) ? obj.cards.map((c) => CardSchema.parse(c)) : [],
  };
}

export async function saveCollection(collection: VegaCollection, hub?: string): Promise<void> {
  const p = vegaPaths(hub);
  const validated = VegaCollectionSchema.parse(collection);
  await writeJson(p.cardsJson, validated);
}

export async function appendReviewLog(entry: ReviewLogEntry, hub?: string): Promise<void> {
  const p = vegaPaths(hub);
  const validated = ReviewLogEntrySchema.parse(entry);
  await atomicAppendFile(p.reviewsJsonl, JSON.stringify(validated));
}

export async function readReviewLogs(hub?: string): Promise<ReviewLogEntry[]> {
  const p = vegaPaths(hub);
  if (!existsSync(p.reviewsJsonl)) {
    return [];
  }
  const content = await readFile(p.reviewsJsonl, "utf8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const logs: ReviewLogEntry[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      logs.push(ReviewLogEntrySchema.parse(parsed));
    } catch {
      // Skip invalid JSON log lines
    }
  }
  return logs;
}

export async function addCards(
  inputs: CardInput[],
  hub?: string,
): Promise<{ added: Card[]; skipped: number; total: number }> {
  const collection = await loadCollection(hub);
  const added: Card[] = [];
  let skipped = 0;

  for (const raw of inputs) {
    const input = CardInputSchema.parse(raw);
    const originLocator = input.origin.locator ?? "";

    // Check duplicate
    const isDup = collection.cards.some(
      (existing) =>
        existing.origin.kind === input.origin.kind &&
        existing.origin.path === input.origin.path &&
        (existing.origin.locator ?? "") === originLocator &&
        existing.front.trim().toLowerCase() === input.front.trim().toLowerCase(),
    );

    if (isDup) {
      skipped++;
      continue;
    }

    const createdTime = input.created ? new Date(input.created) : new Date();
    const newCard: Card = {
      id: generateCardId("c"),
      subject: input.subject,
      deck: input.deck,
      kind: input.kind ?? "basic",
      front: input.front.trim(),
      back: input.back.trim(),
      hint: input.hint?.trim() || undefined,
      hook: input.hook?.trim() || undefined,
      origin: {
        kind: input.origin.kind,
        path: input.origin.path,
        locator: input.origin.locator,
      },
      tags: input.tags ?? [],
      created: createdTime.toISOString(),
      suspended: input.suspended,
      fsrs: initFsrsState(createdTime),
    };

    collection.cards.push(newCard);
    added.push(newCard);
  }

  if (added.length > 0) {
    await saveCollection(collection, hub);
  }

  return {
    added,
    skipped,
    total: collection.cards.length,
  };
}

export async function getCard(id: string, hub?: string): Promise<Card | null> {
  const collection = await loadCollection(hub);
  return collection.cards.find((c) => c.id === id) ?? null;
}

export async function editCard(id: string, patchRaw: CardPatch, hub?: string): Promise<Card> {
  const collection = await loadCollection(hub);
  const cardIndex = collection.cards.findIndex((c) => c.id === id);
  if (cardIndex === -1) {
    throw new Error(`Card not found with ID: ${id}`);
  }

  const patch = CardPatchSchema.parse(patchRaw);
  const card = collection.cards[cardIndex]!;

  if (patch.front !== undefined) card.front = patch.front.trim();
  if (patch.back !== undefined) card.back = patch.back.trim();
  if (patch.hint !== undefined) card.hint = patch.hint ? patch.hint.trim() : undefined;
  if (patch.hook !== undefined) card.hook = patch.hook ? patch.hook.trim() : undefined;
  if (patch.tags !== undefined) card.tags = patch.tags;
  if (patch.subject !== undefined) card.subject = patch.subject.trim();
  if (patch.deck !== undefined) card.deck = patch.deck ? patch.deck.trim() : undefined;
  if (patch.suspended !== undefined) card.suspended = patch.suspended;

  await saveCollection(collection, hub);
  return card;
}

export async function suspendCard(id: string, suspended?: boolean, hub?: string): Promise<Card> {
  const collection = await loadCollection(hub);
  const card = collection.cards.find((c) => c.id === id);
  if (!card) {
    throw new Error(`Card not found with ID: ${id}`);
  }

  card.suspended = suspended !== undefined ? suspended : !card.suspended;
  await saveCollection(collection, hub);
  return card;
}

export async function deleteCard(id: string, hub?: string): Promise<{ deleted: Card }> {
  const collection = await loadCollection(hub);
  const cardIndex = collection.cards.findIndex((c) => c.id === id);
  if (cardIndex === -1) {
    throw new Error(`Card not found with ID: ${id}`);
  }

  const [deleted] = collection.cards.splice(cardIndex, 1);
  if (!deleted) {
    throw new Error(`Failed to delete card with ID: ${id}`);
  }

  // Soft delete into the log
  await appendReviewLog(
    {
      t: nowIso(),
      card: id,
      rating: "deleted",
      state_before: deleted.fsrs.state,
      due_before: deleted.fsrs.due,
      elapsed_days: 0,
      via: "tool",
    },
    hub,
  );

  await saveCollection(collection, hub);
  return { deleted };
}
