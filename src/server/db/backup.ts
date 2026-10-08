// Backups of a PGlite data folder before migrations (feature 11, data-model.md §6, research R10).
// The store is closed while it is copied, so a plain folder copy is consistent. Snapshots taken
// while the app runs are in snapshots.ts.
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

export const storeDir = (dataDir: string) => path.join(/*turbopackIgnore: true*/ dataDir, "store");
export const backupsDir = (dataDir: string) => path.join(/*turbopackIgnore: true*/ dataDir, "backups");

/** How many pre-migration backups are kept. */
export const KEEP_PRE_MIGRATION = 5;

/** UTC `YYYYMMDDTHHMMSSZ`, which sorts by time as plain text. */
export function backupStamp(at = new Date()): string {
  return at.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

/** Opens a copied store and reads from it, so a backup is only trusted once it is known to open. */
export async function verifyStoreCopy(dir: string): Promise<void> {
  const pg = new PGlite({ dataDir: dir, extensions: { vector } });
  try {
    await pg.query("SELECT count(*) FROM kysely_migration");
  } finally {
    await pg.close();
  }
}

/**
 * Copies `<dataDir>/store` to `backups/<stamp>-pre-<migration>/` and checks the copy opens. The
 * caller must have closed the store and still hold its lock. Returns the backup's path.
 */
export async function backupBeforeMigration(dataDir: string, firstPending: string, at = new Date()): Promise<string> {
  mkdirSync(/*turbopackIgnore: true*/ backupsDir(dataDir), { recursive: true });
  const base = path.join(/*turbopackIgnore: true*/ backupsDir(dataDir), `${backupStamp(at)}-pre-${firstPending}`);
  let dest = base;
  for (let n = 2; existsSync(/*turbopackIgnore: true*/ dest); n++) dest = `${base}-${n}`;
  // Copy under a temporary name first, so a half-written copy never looks like a backup.
  const partial = `${dest}.partial`;
  rmSync(/*turbopackIgnore: true*/ partial, { recursive: true, force: true });
  try {
    cpSync(/*turbopackIgnore: true*/ storeDir(dataDir), partial, { recursive: true, errorOnExist: true });
    await verifyStoreCopy(partial);
    renameSync(/*turbopackIgnore: true*/ partial, dest);
  } catch (err) {
    rmSync(/*turbopackIgnore: true*/ partial, { recursive: true, force: true });
    throw err;
  }
  return dest;
}

/** Replaces `<dataDir>/store` with a backup. The store must be closed and its lock held. */
export function restoreStore(dataDir: string, backup: string): void {
  const store = storeDir(dataDir);
  const failed = `${store}.failed`;
  rmSync(/*turbopackIgnore: true*/ failed, { recursive: true, force: true });
  // Keep the failed store until the restore is in place, then drop it.
  if (existsSync(/*turbopackIgnore: true*/ store)) renameSync(/*turbopackIgnore: true*/ store, failed);
  cpSync(/*turbopackIgnore: true*/ backup, store, { recursive: true });
  rmSync(/*turbopackIgnore: true*/ failed, { recursive: true, force: true });
}

/** Removes all but the newest `keep` pre-migration backups. */
export function prunePreMigrationBackups(dataDir: string, keep = KEEP_PRE_MIGRATION): string[] {
  const dir = backupsDir(dataDir);
  if (!existsSync(/*turbopackIgnore: true*/ dir)) return [];
  const backups = readdirSync(/*turbopackIgnore: true*/ dir)
    .filter((name) => /^\d{8}T\d{6}Z-pre-/.test(name) && !name.endsWith(".partial"))
    .sort()
    .reverse();
  const removed = backups.slice(keep);
  for (const name of removed) rmSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ dir, name), { recursive: true, force: true });
  return removed;
}
