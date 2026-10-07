import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acquireStoreLock, lockPath, readLock, releaseStoreLock, StoreLockedError } from "@/server/db/storeLock";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "farabi-lock-"));

describe("store lock (data-model.md §1)", () => {
  it("takes and releases the lock", () => {
    const dir = tmp();
    const info = acquireStoreLock(dir);
    expect(readLock(dir)).toEqual(info);
    releaseStoreLock(dir);
    expect(readLock(dir)).toBeNull();
  });

  it("refuses while another live process holds it", () => {
    const dir = tmp();
    // The parent of the test runner is alive for the whole test.
    writeFileSync(lockPath(dir), JSON.stringify({ pid: process.ppid, startedAt: "2026-10-07T00:00:00Z" }));
    expect(() => acquireStoreLock(dir)).toThrow(StoreLockedError);
  });

  it("replaces a stale lock left by a dead process", () => {
    const dir = tmp();
    writeFileSync(lockPath(dir), JSON.stringify({ pid: 2 ** 22 + 12345, startedAt: "2026-10-07T00:00:00Z" }));
    expect(acquireStoreLock(dir).pid).toBe(process.pid);
  });

  it("doesn't remove a lock held by someone else", () => {
    const dir = tmp();
    writeFileSync(lockPath(dir), JSON.stringify({ pid: process.ppid, startedAt: "x" }));
    releaseStoreLock(dir);
    expect(readLock(dir)?.pid).toBe(process.ppid);
  });
});
