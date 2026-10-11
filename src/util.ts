import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const VERSION = "0.2.1";

export function resolveHubDir(hub?: string): string {
  const envHub = process.env.VEGA_HUB;
  if (hub && hub.trim()) {
    return resolve(hub);
  }
  if (envHub && envHub.trim()) {
    return resolve(envHub);
  }
  return resolve("D:/02_Learning_Knowledge");
}

export function vegaPaths(hub?: string): {
  root: string;
  vegaDir: string;
  cardsJson: string;
  reviewsJsonl: string;
  syncStateJson: string;
  sessionDir: string;
  sessionDeckJson: string;
  sessionProgressJsonl: string;
} {
  const root = resolveHubDir(hub);
  const vegaDir = join(root, ".vega");
  const sessionDir = join(vegaDir, "session");
  return {
    root,
    vegaDir,
    cardsJson: join(vegaDir, "cards.json"),
    reviewsJsonl: join(vegaDir, "reviews.jsonl"),
    syncStateJson: join(vegaDir, "sync-state.json"),
    sessionDir,
    sessionDeckJson: join(sessionDir, "deck.json"),
    sessionProgressJsonl: join(sessionDir, "progress.jsonl"),
  };
}

export function localTodayIso(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function nowIso(d: Date = new Date()): string {
  return d.toISOString();
}

export function parseDate(input?: string | Date): Date {
  if (!input) return new Date();
  if (input instanceof Date) return input;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [y, m, d] = input.split("-").map(Number);
    return new Date(y!, m! - 1, d!, 12, 0, 0, 0);
  }
  const parsed = new Date(input);
  if (isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

export function startOfDay(input: string | Date): Date {
  const d = parseDate(input);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

export function endOfDay(input: string | Date): Date {
  const d = parseDate(input);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function addDays(dateStrOrDate: string | Date, days: number): string {
  const d = parseDate(dateStrOrDate);
  const next = new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
  return localTodayIso(next);
}

export function daysBetween(d1: Date, d2: Date): number {
  const ms = Math.abs(d2.getTime() - d1.getTime());
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.tmp.${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(tmpPath, content, "utf8");
  try {
    await rename(tmpPath, filePath);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "EEXIST" || code === "EPERM") {
      try {
        await unlink(filePath);
      } catch {
        // ignore if not existing
      }
      await rename(tmpPath, filePath);
    } else {
      try {
        await unlink(tmpPath);
      } catch {
        // ignore cleanup error
      }
      throw err;
    }
  }
}

export async function atomicAppendFile(filePath: string, line: string): Promise<void> {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await appendFile(filePath, line.endsWith("\n") ? line : line + "\n", "utf8");
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  if (!existsSync(filePath)) return null;
  try {
    const text = await readFile(filePath, "utf8");
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  const content = JSON.stringify(data, null, 2);
  await atomicWriteFile(filePath, content);
}

export function hash(str: string, len = 8): string {
  return createHash("sha256").update(str, "utf8").digest("hex").slice(0, len);
}

let counter = 0;
export function generateCardId(prefix = "c"): string {
  counter = (counter + 1) % 10000;
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  const countStr = counter.toString(36).padStart(3, "0");
  return `${prefix}_${time}${countStr}_${rand}`;
}

export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
