import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { initFsrsState, stepFsrs } from "./fsrs.js";
import {
  CardInputSchema,
  CardPatchSchema,
  CardSchema,
  ReviewLogEntrySchema,
  SyncStateSchema,
  VegaCollectionSchema,
  type Card,
  type CardInput,
  type CardPatch,
  type FsrsState,
  type ReviewLogEntry,
  type SyncState,
  type VegaCollection,
} from "./schema.js";
import {
  atomicAppendFile,
  atomicWriteFile,
  generateCardId,
  nowIso,
  parseDate,
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

export function deriveMissingStates(logs: ReviewLogEntry[]): void {
  const byCard = new Map<string, ReviewLogEntry[]>();
  for (const log of logs) {
    if (log.rating === "deleted") continue;
    let list = byCard.get(log.card);
    if (!list) {
      list = [];
      byCard.set(log.card, list);
    }
    list.push(log);
  }

  for (const [, cardLogs] of byCard) {
    cardLogs.sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
    let simState: FsrsState | null = null;

    for (const log of cardLogs) {
      if (log.rating === "deleted") continue;

      if (log.state_before !== undefined) {
        if (simState === null) {
          const reviewDate = parseDate(log.t);
          simState = initFsrsState(reviewDate);
          simState.state = log.state_before;
        } else {
          simState.state = log.state_before;
        }
        try {
          simState = stepFsrs(simState, log.rating, parseDate(log.t)).nextState;
        } catch {
          simState = null;
        }
      } else {
        if (simState !== null) {
          log.state_before = simState.state;
          try {
            simState = stepFsrs(simState, log.rating, parseDate(log.t)).nextState;
          } catch {
            simState = null;
          }
        }
      }
    }
  }
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
  deriveMissingStates(logs);
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

export async function loadSyncState(hub?: string): Promise<SyncState> {
  const p = vegaPaths(hub);
  const data = await readJson<unknown>(p.syncStateJson);
  if (!data) {
    return {
      version: 1,
      processed_hashes: [],
    };
  }
  const parsed = SyncStateSchema.safeParse(data);
  if (parsed.success) {
    return parsed.data;
  }
  const obj = data as { version?: number; last_sync?: string; processed_hashes?: string[] };
  return {
    version: obj.version ?? 1,
    last_sync: obj.last_sync,
    processed_hashes: Array.isArray(obj.processed_hashes) ? obj.processed_hashes : [],
  };
}

export async function saveSyncState(syncState: SyncState, hub?: string): Promise<void> {
  const p = vegaPaths(hub);
  const validated = SyncStateSchema.parse(syncState);
  await writeJson(p.syncStateJson, validated);
}

