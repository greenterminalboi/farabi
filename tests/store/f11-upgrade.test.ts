// Upgrades on a real PGlite data folder (feature 11, US6, quickstart V10): back up before
// migrating, restore when a migration fails, refuse data from a newer Farabi without touching it,
// and keep only the newest pre-migration backups.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "kysely";
import type { Migration } from "kysely/migration";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "farabi-upgrade-"));
process.env.FARABI_DATA_DIR = dataDir;

const { db, closeDb } = await import("@/server/db/client");
const { MIGRATIONS } = await import("@/server/db/migrationList");
const { prepareStore, schemaFilePath, StartupBlocked } = await import("@/server/db/startup");
const { backupsDir, prunePreMigrationBackups, verifyStoreCopy } = await import("@/server/db/backup");

const names = Object.keys(MIGRATIONS).sort();
const latest = names.at(-1)!;
const allButLatest = Object.fromEntries(names.slice(0, -1).map((n) => [n, MIGRATIONS[n]]));

/** Every file under a folder with its modification time. */
function mtimes(dir: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    out[path.relative(dir, full)] = statSync(full).mtimeMs;
  }
  return out;
}

async function executed(): Promise<string[]> {
  const { rows } = await sql<{ name: string }>`SELECT name FROM kysely_migration ORDER BY name`.execute(db);
  return rows.map((r) => r.name);
}

const preBackups = () => readdirSync(backupsDir(dataDir)).filter((n) => n.includes("-pre-"));

describe("upgrades on a PGlite data folder", () => {
  beforeAll(async () => {
    // A store one migration behind, as an older Farabi would have left it. A new store isn't backed up.
    await prepareStore({ migrations: allButLatest });
    await db.insertInto("projects").values({ name: "Kept across upgrades" }).execute();
    await closeDb();
  });
  afterAll(async () => {
    await closeDb();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("backs up the closed store, checks the copy opens, then migrates", async () => {
    expect(await prepareStore()).toBe(latest);
    const backups = preBackups();
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(new RegExp(`^\\d{8}T\\d{6}Z-pre-${latest}$`));
    expect(await executed()).toEqual(names);
    await closeDb();
    // The backup is a whole store at the old level, with the user's data in it.
    await expect(verifyStoreCopy(path.join(backupsDir(dataDir), backups[0]))).resolves.toBeUndefined();
  });

  it("restores the store from the backup when a migration fails", async () => {
    const boom: Migration = {
      async up(trx) {
        await sql`CREATE TABLE boom (x int)`.execute(trx);
        throw new Error("boom");
      },
    };
    const err = await prepareStore({ migrations: { ...MIGRATIONS, "0099_boom": boom } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StartupBlocked);
    expect((err as InstanceType<typeof StartupBlocked>).screen).toBe("upgrade-failed");
    expect(await executed()).toEqual(names);
    const { rows } = await sql<{ t: string | null }>`SELECT to_regclass('public.boom')::text AS t`.execute(db);
    expect(rows[0].t).toBeNull();
    const projects = await db.selectFrom("projects").select("name").execute();
    expect(projects.map((p) => p.name)).toContain("Kept across upgrades");
    expect(preBackups()).toHaveLength(2);
    await closeDb();
  });

  it("refuses data from a newer Farabi and changes no file", async () => {
    // A newer Farabi ran 0099_future and recorded it in the marker beside the store.
    const future: Migration = { up: async () => undefined };
    await prepareStore({ migrations: { ...MIGRATIONS, "0099_future": future } });
    await closeDb();
    const before = mtimes(path.join(dataDir, "store"));
    const err = await prepareStore().catch((e: unknown) => e);
    expect((err as InstanceType<typeof StartupBlocked>).screen).toBe("newer-data");
    await closeDb();
    expect(mtimes(path.join(dataDir, "store"))).toEqual(before);
  });

  it("still refuses a newer store whose marker was never written", async () => {
    rmSync(schemaFilePath(dataDir));
    const err = await prepareStore().catch((e: unknown) => e);
    expect((err as InstanceType<typeof StartupBlocked>).screen).toBe("newer-data");
    await closeDb();
  });

  it("keeps only the 5 newest pre-migration backups", () => {
    for (let day = 1; day <= 6; day++) mkdirSync(path.join(backupsDir(dataDir), `202001${String(day).padStart(2, "0")}T000000Z-pre-0001_x`));
    mkdirSync(path.join(backupsDir(dataDir), "auto-20200101T000000Z"), { recursive: true });
    const before = preBackups().sort();
    const removed = prunePreMigrationBackups(dataDir);
    expect(removed.sort()).toEqual(before.slice(0, before.length - 5));
    expect(preBackups()).toHaveLength(5);
    // Snapshots are pruned on their own schedule, not here.
    expect(readdirSync(backupsDir(dataDir))).toContain("auto-20200101T000000Z");
  });
});
