// Automatic snapshots of the live store (feature 11, T074). PGlite runs without fsync (research R2),
// so a power cut can lose recent commits; a snapshot every 10 minutes while the data has changed,
// and one on a clean quit, bound that loss. A restore is staged here and applied at the next start,
// while the store is closed.
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { backupsDir, backupStamp, storeDir } from "./backup";
import { getPglite } from "./client";

export const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;
export const KEEP_SNAPSHOTS = 6;
const SNAPSHOT_RE = /^auto-(\d{8}T\d{6}Z)\.tar\.gz$/;

export type Snapshot = { name: string; takenAt: string; bytes: number };

const g = globalThis as unknown as { __farabiSnapshots?: { lastLsn: string | null; timer: NodeJS.Timeout | null; running: Promise<unknown> | null } };
const state = () => (g.__farabiSnapshots ??= { lastLsn: null, timer: null, running: null });

/** The WAL position: it moves on every write, and not on reads or dumps. */
async function walPosition(pglite: PGlite): Promise<string> {
  const { rows } = await pglite.query<{ lsn: string }>("SELECT pg_current_wal_lsn()::text AS lsn");
  return rows[0].lsn;
}

function stampToIso(stamp: string): string {
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
}

/** Snapshots in `backups/`, newest first. */
export function listSnapshots(dataDir: string): Snapshot[] {
  const dir = backupsDir(dataDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => ({ name, m: SNAPSHOT_RE.exec(name) }))
    .filter((e): e is { name: string; m: RegExpExecArray } => e.m !== null)
    .map(({ name, m }) => ({ name, takenAt: stampToIso(m[1]), bytes: statSync(path.join(dir, name)).size }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

/**
 * Writes `backups/auto-<stamp>.tar.gz` if the store changed since the last snapshot (or always,
 * with `force`). Keeps the newest KEEP_SNAPSHOTS. Returns the new snapshot, or null if skipped.
 */
export async function takeSnapshot({ force = false, at = new Date() }: { force?: boolean; at?: Date } = {}): Promise<Snapshot | null> {
  const disk = getPglite();
  if (!disk || disk.pglite.closed) return null;
  const s = state();
  // One at a time: the timer and a quit can overlap.
  while (s.running) await s.running.catch(() => undefined);
  const run = (async () => {
    const lsn = await walPosition(disk.pglite);
    if (!force && lsn === s.lastLsn) return null;
    const dump = await disk.pglite.dumpDataDir("gzip");
    const dir = backupsDir(disk.dataDir);
    mkdirSync(dir, { recursive: true });
    const name = `auto-${backupStamp(at)}.tar.gz`;
    const tmp = path.join(dir, `${name}.partial`);
    writeFileSync(tmp, Buffer.from(await dump.arrayBuffer()));
    renameSync(tmp, path.join(dir, name));
    s.lastLsn = lsn;
    pruneSnapshots(disk.dataDir);
    return { name, takenAt: stampToIso(backupStamp(at)), bytes: dump.size };
  })();
  s.running = run;
  try {
    return await run;
  } finally {
    s.running = null;
  }
}

export function pruneSnapshots(dataDir: string, keep = KEEP_SNAPSHOTS): string[] {
  const removed = listSnapshots(dataDir).slice(keep).map((s) => s.name);
  for (const name of removed) rmSync(path.join(backupsDir(dataDir), name), { force: true });
  return removed;
}

/** Starts the 10-minute schedule. The first snapshot comes after the first interval with changes. */
export async function startSnapshots(intervalMs = SNAPSHOT_INTERVAL_MS): Promise<void> {
  const disk = getPglite();
  if (!disk) return;
  const s = state();
  // Start from the store as opened: a launch with no changes takes no snapshot.
  s.lastLsn = await walPosition(disk.pglite);
  if (s.timer) clearInterval(s.timer);
  s.timer = setInterval(() => {
    takeSnapshot().catch((err) => console.error("Automatic snapshot failed", err));
  }, intervalMs);
  s.timer.unref();
}

/** Stops the schedule and takes a last snapshot if anything changed (clean quit). */
export async function stopSnapshots({ final = true }: { final?: boolean } = {}): Promise<void> {
  const s = state();
  if (s.timer) clearInterval(s.timer);
  s.timer = null;
  if (final) await takeSnapshot();
}

// ── Restore ─────────────────────────────────────────────────────────────────────────────────────

const restoreFile = (dataDir: string) => path.join(dataDir, "restore-pending.json");

/** Stages a restore; it is applied on the next start, before the store opens. */
export function requestRestore(dataDir: string, name: string): void {
  if (!SNAPSHOT_RE.test(name) || !existsSync(path.join(backupsDir(dataDir), name))) {
    throw new Error(`No snapshot named ${name}`);
  }
  writeFileSync(restoreFile(dataDir), JSON.stringify({ snapshot: name, requestedAt: new Date().toISOString() }));
}

/**
 * Applies a staged restore. The store must be closed and its lock held. The replaced store is kept
 * as `backups/replaced-<stamp>/` so a restore can itself be undone by hand. Returns the snapshot
 * name, or null when nothing was staged.
 */
export async function applyPendingRestore(dataDir: string, at = new Date()): Promise<string | null> {
  const file = restoreFile(dataDir);
  if (!existsSync(file)) return null;
  const { snapshot } = JSON.parse(readFileSync(file, "utf8")) as { snapshot: string };
  // Remove the request first: a restore that fails must not be retried on every launch.
  rmSync(file, { force: true });
  if (!SNAPSHOT_RE.test(snapshot)) throw new Error(`Bad snapshot name ${snapshot}`);
  const blob = new Blob([readFileSync(path.join(backupsDir(dataDir), snapshot))]);
  const store = storeDir(dataDir);
  const incoming = `${store}.restoring`;
  rmSync(incoming, { recursive: true, force: true });
  // Load into a side folder first; the live store is only swapped once the load has worked.
  const pg = new PGlite({ dataDir: incoming, loadDataDir: blob, extensions: { vector } });
  try {
    await pg.query("SELECT count(*) FROM kysely_migration");
  } finally {
    await pg.close();
  }
  if (existsSync(store)) renameSync(store, path.join(backupsDir(dataDir), `replaced-${backupStamp(at)}`));
  renameSync(incoming, store);
  // Keep the two newest replaced stores.
  const replaced = readdirSync(backupsDir(dataDir)).filter((n) => n.startsWith("replaced-")).sort().reverse();
  for (const name of replaced.slice(2)) rmSync(path.join(backupsDir(dataDir), name), { recursive: true, force: true });
  return snapshot;
}
