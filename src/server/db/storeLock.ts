// One process per data folder: a second PGlite opener corrupts the store (PGlite issue #1106), so
// the server and every script take this lock first (feature 11, data-model.md §1).
import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import path from "node:path";

export type LockInfo = { pid: number; startedAt: string };

export class StoreLockedError extends Error {
  constructor(readonly holder: LockInfo) {
    super(`The data folder is in use by process ${holder.pid} (since ${holder.startedAt})`);
    this.name = "StoreLockedError";
  }
}

export const lockPath = (dataDir: string) => path.join(/*turbopackIgnore: true*/ dataDir, "store.lock");

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists but belongs to someone else, which still counts as alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function readLock(dataDir: string): LockInfo | null {
  try {
    return JSON.parse(readFileSync(/*turbopackIgnore: true*/ lockPath(dataDir), "utf8")) as LockInfo;
  } catch {
    return null;
  }
}

/** Takes the lock, replacing a stale one (dead pid). Throws StoreLockedError if it's live. */
export function acquireStoreLock(dataDir: string, pid = process.pid): LockInfo {
  const info: LockInfo = { pid, startedAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(/*turbopackIgnore: true*/ lockPath(dataDir), "wx", 0o600);
      writeSync(fd, JSON.stringify(info));
      closeSync(fd);
      return info;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const holder = readLock(dataDir);
      if (holder && holder.pid !== pid && pidAlive(holder.pid)) throw new StoreLockedError(holder);
      // Stale (or unreadable, or our own from an earlier start in this process): replace it.
      rmSync(/*turbopackIgnore: true*/ lockPath(dataDir), { force: true });
    }
  }
  throw new Error("Could not take the store lock");
}

/** Removes the lock if this process holds it. */
export function releaseStoreLock(dataDir: string, pid = process.pid): void {
  const holder = readLock(dataDir);
  if (holder?.pid === pid) rmSync(/*turbopackIgnore: true*/ lockPath(dataDir), { force: true });
}
