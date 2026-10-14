import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { QueueEntry } from "./approval";
import { executedCentsOn, type PaymentDraft } from "./ledger";

/** Saved state of one period: the ledger's drafts and the approval queue built by the agent run. */
export interface CoopState {
  period: string;
  savedAt: string;
  source: "agent" | "scripted_rehearsal";
  model: string | null;
  drafts: PaymentDraft[];
  queue: QueueEntry[];
  problems: string[];
}

export const statePath = (dir: string, period: string) => {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error(`Invalid period: ${period}`);
  return path.join(dir, `${period}.json`);
};

export function loadState(dir: string, period: string): CoopState | null {
  const file = statePath(dir, period);
  if (!existsSync(file)) return null;
  const s = JSON.parse(readFileSync(file, "utf8")) as CoopState;
  if (s.period !== period || !Array.isArray(s.drafts) || !Array.isArray(s.queue)) throw new Error(`${file} is not a state file for ${period}`);
  return s;
}

/** Writes via a temporary file and rename, so a crash never leaves a half-written state file. */
export function saveState(dir: string, s: CoopState): void {
  mkdirSync(dir, { recursive: true });
  const file = statePath(dir, s.period);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2) + "\n");
  renameSync(tmp, file);
}

/** A lock older than this is left over from a crashed process; locks are only held for one read and write. */
const STALE_LOCK_MS = 30_000;

/** Runs `fn` while holding an exclusive lock file. Throws at once if another process holds it (try again). */
export function withLock<T>(lock: string, what: string, fn: () => T): T {
  mkdirSync(path.dirname(lock), { recursive: true });
  let fd: number;
  try {
    fd = openSync(lock, "wx");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    if (Date.now() - statSync(lock).mtimeMs < STALE_LOCK_MS) throw new Error(`${what} is being saved by another process; try again`);
    unlinkSync(lock);
    fd = openSync(lock, "wx");
  }
  try {
    return fn();
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}

/** Lock shared by every month of one operator account: taken around the daily-limit check and the executing record. */
export const accountLockPath = (dir: string) => path.join(dir, "account.lock");

/**
 * Read-modify-write of one period's state under a lock file, so the web desk and the CLI never overwrite each
 * other's changes: `change` receives the latest saved state, read after the lock is taken. Throws if another process
 * holds the lock (try again) or if `change` throws (nothing is written).
 */
export function updateState(dir: string, period: string, change: (current: CoopState | null) => CoopState): CoopState {
  return withLock(`${statePath(dir, period)}.lock`, `State for ${period}`, () => {
    const next = change(loadState(dir, period));
    if (next.period !== period) throw new Error(`State for ${next.period} cannot be saved as ${period}`);
    saveState(dir, next);
    return next;
  });
}

/** Replaces the given drafts by id (adding new ones), leaving every other draft as currently saved. */
export function mergeDrafts(current: PaymentDraft[], changed: PaymentDraft[]): PaymentDraft[] {
  const byId = new Map(changed.map((d) => [d.id, d]));
  return [...current.map((d) => byId.get(d.id) ?? d), ...changed.filter((d) => !current.some((c) => c.id === d.id))];
}

/** Amount executed on a Berlin day in every saved month except `exceptPeriod`, for the account-wide daily limit. */
export function executedCentsOnDay(dir: string, day: string, exceptPeriod: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir)
    .map((f) => /^(\d{4}-\d{2})\.json$/.exec(f)?.[1])
    .filter((p): p is string => !!p && p !== exceptPeriod)
    .reduce((sum, p) => sum + executedCentsOn(loadState(dir, p)!.drafts, day), 0);
}
