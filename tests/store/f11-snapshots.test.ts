// Automatic snapshots and restore on a real PGlite data folder (feature 11, T074).
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "farabi-snapshots-"));
process.env.FARABI_DATA_DIR = dataDir;

const { db, closeDb } = await import("@/server/db/client");
const { prepareStore } = await import("@/server/db/startup");
const { backupsDir } = await import("@/server/db/backup");
const { acquireStoreLock } = await import("@/server/db/storeLock");
const snapshots = await import("@/server/db/snapshots");

const projectNames = async () => (await db.selectFrom("projects").select("name").orderBy("name").execute()).map((p) => p.name);

describe("automatic snapshots", () => {
  beforeAll(async () => {
    await prepareStore();
    await snapshots.startSnapshots(60 * 60 * 1000);
  });
  afterAll(async () => {
    await snapshots.stopSnapshots({ final: false });
    await closeDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("takes no snapshot while nothing has changed", async () => {
    expect(await snapshots.takeSnapshot()).toBeNull();
    await projectNames();
    expect(await snapshots.takeSnapshot()).toBeNull();
    expect(snapshots.listSnapshots(dataDir)).toEqual([]);
  });

  it("takes one after a change, and not again until the next change", async () => {
    await db.insertInto("projects").values({ name: "Before the snapshot" }).execute();
    const snap = await snapshots.takeSnapshot({ at: new Date("2026-10-07T10:00:00Z") });
    expect(snap?.name).toBe("auto-20261007T100000Z.tar.gz");
    expect(snap!.bytes).toBeGreaterThan(0);
    expect(await snapshots.takeSnapshot()).toBeNull();
  });

  it("keeps the newest 6", async () => {
    for (let minute = 10; minute <= 16; minute++) {
      await db.insertInto("projects").values({ name: `Churn ${minute}` }).execute();
      await snapshots.takeSnapshot({ at: new Date(`2026-10-07T10:${minute}:00Z`) });
    }
    const names = snapshots.listSnapshots(dataDir).map((s) => s.name);
    expect(names).toHaveLength(6);
    expect(names[0]).toBe("auto-20261007T101600Z.tar.gz");
    expect(names.at(-1)).toBe("auto-20261007T101100Z.tar.gz");
  });

  it("restores a staged snapshot at the next start and keeps the replaced store", async () => {
    const target = snapshots.listSnapshots(dataDir).at(-1)!; // 10:11, after "Churn 11"
    const atSnapshot = (await projectNames()).filter((n) => n <= "Churn 11" || !n.startsWith("Churn"));
    await db.insertInto("projects").values({ name: "After the snapshot" }).execute();
    snapshots.requestRestore(dataDir, target.name);
    await snapshots.stopSnapshots({ final: false });
    await closeDb({ keepLock: true });

    expect(await snapshots.applyPendingRestore(dataDir)).toBe(target.name);
    expect(existsSync(path.join(dataDir, "restore-pending.json"))).toBe(false);
    expect(readdirSync(backupsDir(dataDir)).some((n) => n.startsWith("replaced-"))).toBe(true);

    await prepareStore();
    const names = await projectNames();
    expect(names).not.toContain("After the snapshot");
    expect(names).toEqual(atSnapshot);
  });

  it("leaves the store alone when a staged snapshot can't be loaded", async () => {
    await db.insertInto("projects").values({ name: "Survives a bad restore" }).execute();
    const bad = "auto-20200101T000000Z.tar.gz";
    writeFileSync(path.join(backupsDir(dataDir), bad), "not a tarball");
    snapshots.requestRestore(dataDir, bad);
    await closeDb({ keepLock: true });
    acquireStoreLock(dataDir);
    await expect(snapshots.applyPendingRestore(dataDir)).rejects.toThrow();
    // The request is gone, so a broken snapshot isn't retried on every launch.
    expect(await snapshots.applyPendingRestore(dataDir)).toBeNull();
    await prepareStore();
    expect(await projectNames()).toContain("Survives a bad restore");
  });

  it("refuses to stage a snapshot that doesn't exist", () => {
    expect(() => snapshots.requestRestore(dataDir, "auto-19990101T000000Z.tar.gz")).toThrow(/No snapshot/);
    expect(() => snapshots.requestRestore(dataDir, "../store")).toThrow(/No snapshot/);
  });
});
