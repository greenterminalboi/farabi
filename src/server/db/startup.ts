// Desktop mode start-up and shutdown (feature 11, data-model.md §6): handshake with the shell,
// open the store under its lock, refuse data from a newer Farabi, migrate, write runtime.json, then
// tell the shell the server is ready. Shutdown stops replies the way Stop does and closes the store.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { sql } from "kysely";
import { type Migration, Migrator } from "kysely/migration";
import { type Hello, startBridge } from "../host/bridge";
import { installLogRedaction, registerSecret } from "../host/redact";
import { setHostInfo } from "../host/info";
import { setSession } from "../host/session";
import { backupBeforeMigration, prunePreMigrationBackups, restoreStore } from "./backup";
import { closeDb, db, getPglite, storeTarget } from "./client";
import { MIGRATIONS } from "./migrationList";
import { applyPendingRestore, startSnapshots, stopSnapshots } from "./snapshots";
import { acquireStoreLock, StoreLockedError } from "./storeLock";

export type BlockedScreen = "newer-data" | "store-locked" | "backup-failed" | "upgrade-failed";

export class StartupBlocked extends Error {
  constructor(
    readonly screen: BlockedScreen,
    detail: string,
  ) {
    super(detail);
    this.name = "StartupBlocked";
  }
}

export const runtimeFilePath = (dataDir: string) => path.join(/*turbopackIgnore: true*/ dataDir, "runtime.json");
/** The migrations a store holds, kept beside it so a newer store is refused without opening it. */
export const schemaFilePath = (dataDir: string) => path.join(/*turbopackIgnore: true*/ dataDir, "store-schema.json");

/** Even a read-only open rewrites PGlite's control files, so this check reads only the marker. */
function markedMigrations(dataDir: string): string[] {
  try {
    const marker = JSON.parse(readFileSync(/*turbopackIgnore: true*/ schemaFilePath(dataDir), "utf8")) as { migrations?: unknown };
    return Array.isArray(marker.migrations) ? marker.migrations.filter((m): m is string => typeof m === "string") : [];
  } catch {
    return [];
  }
}

function newerDataError(unknown: string[]): StartupBlocked {
  return new StartupBlocked("newer-data", `This data includes ${unknown.join(", ")}, which this version of Farabi doesn't know.`);
}

/** Names of migrations recorded in the store, oldest first (empty for a new store). */
async function executedMigrations(): Promise<string[]> {
  const { rows } = await sql<{ t: string | null }>`SELECT to_regclass('public.kysely_migration')::text AS t`.execute(db);
  if (!rows[0]?.t) return [];
  const res = await sql<{ name: string }>`SELECT name FROM kysely_migration ORDER BY name`.execute(db);
  return res.rows.map((r) => r.name);
}

/**
 * Opens the store and brings it up to date. Returns the schema level (the newest migration name).
 * Throws StartupBlocked when the shell should show one of its screens instead of the app.
 *
 * On a PGlite data folder, pending migrations run only after the closed store has been copied to
 * `backups/` and the copy opened. If a migration fails, the store is put back from that copy.
 */
export async function prepareStore(opts: { migrations?: Record<string, Migration> } = {}): Promise<string> {
  const migrations = opts.migrations ?? MIGRATIONS;
  const known = new Set(Object.keys(migrations));
  const target = storeTarget();
  const dataDir = target.kind === "pglite" && target.dataDir !== "memory://" ? target.dataDir : null;
  if (dataDir) {
    const unknownMarked = markedMigrations(dataDir).filter((name) => !known.has(name));
    if (unknownMarked.length) throw newerDataError(unknownMarked);
  }
  let executed: string[];
  try {
    executed = await executedMigrations();
  } catch (err) {
    if (err instanceof StoreLockedError) throw new StartupBlocked("store-locked", err.message);
    throw err;
  }
  // The marker can lag if a newer Farabi stopped between migrating and writing it.
  const unknown = executed.filter((name) => !known.has(name));
  if (unknown.length) throw newerDataError(unknown);
  const names = Object.keys(migrations).sort();
  const pending = names.filter((name) => !executed.includes(name));
  if (pending.length) {
    // A brand-new store has nothing worth backing up.
    const disk = executed.length ? getPglite() : undefined;
    let backup: string | null = null;
    if (disk) {
      await closeDb({ keepLock: true });
      try {
        backup = await backupBeforeMigration(disk.dataDir, pending[0]);
      } catch (err) {
        throw new StartupBlocked(
          "backup-failed",
          `Farabi couldn't back up your data before updating it, so nothing was changed. ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    const { error } = await new Migrator({ db, provider: { getMigrations: async () => migrations } }).migrateToLatest();
    if (error) {
      if (!disk || !backup) throw error;
      await closeDb({ keepLock: true });
      restoreStore(disk.dataDir, backup);
      throw new StartupBlocked(
        "upgrade-failed",
        `Updating your data failed, so it was put back as it was before. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (disk) prunePreMigrationBackups(disk.dataDir);
  }
  if (dataDir) writeFileSync(/*turbopackIgnore: true*/ schemaFilePath(dataDir), JSON.stringify({ migrations: names, writtenAt: new Date().toISOString() }, null, 2));
  return names.at(-1) ?? "";
}

let shuttingDown: Promise<void> | null = null;

/** Stops replies, closes the store, removes runtime.json and the lock. Idempotent. */
export function shutdown(dataDir: string): Promise<void> {
  shuttingDown ??= (async () => {
    try {
      const { stopAllGenerations } = await import("../answers/generation");
      await stopAllGenerations(3000);
    } catch (err) {
      console.error("Stopping live replies failed during shutdown", err);
    }
    try {
      await stopSnapshots();
    } catch (err) {
      console.error("The last snapshot before quitting failed", err);
    }
    try {
      await closeDb();
    } finally {
      rmSync(/*turbopackIgnore: true*/ runtimeFilePath(dataDir), { force: true });
    }
  })();
  return shuttingDown;
}

/** Puts back a snapshot chosen in Settings, while the store is still closed (T074). */
async function applyRestoreIfStaged(dataDir: string): Promise<void> {
  try {
    acquireStoreLock(dataDir);
  } catch (err) {
    if (err instanceof StoreLockedError) throw new StartupBlocked("store-locked", err.message);
    throw err;
  }
  try {
    const restored = await applyPendingRestore(dataDir);
    if (restored) console.error(`Restored the data from snapshot ${restored}.`);
  } catch (err) {
    // The live store is only swapped after the snapshot loads, so it is untouched here.
    console.error("Restoring the snapshot failed; starting with the data as it was.", err);
  }
}

/** The whole desktop start-up, run from instrumentation.ts when FARABI_HOST=tauri. */
export async function desktopStartup(
  io: { stdin: Readable; stdout: Writable } = { stdin: process.stdin, stdout: process.stdout },
): Promise<void> {
  installLogRedaction();
  const bridge = startBridge(io.stdin, io.stdout);
  const hello: Hello = await bridge.hello;
  setSession({ secret: hello.secret, port: hello.port });
  registerSecret(hello.secret);
  const dataDir = process.env.FARABI_DATA_DIR || hello.dataDir;
  process.env.FARABI_DATA_DIR = dataDir;

  const exit = (code: number) => setTimeout(() => process.exit(code), 50);
  bridge.onRequest("shutdown", async () => {
    await shutdown(dataDir);
    exit(0);
    return { ok: true };
  });
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => void shutdown(dataDir).finally(() => exit(0)));
  }
  // The shell went away without saying so (crash, force quit): close cleanly anyway.
  bridge.on("closed", () => void shutdown(dataDir).finally(() => exit(0)));

  try {
    await applyRestoreIfStaged(dataDir);
    const schemaLevel = await prepareStore();
    await startSnapshots();
    const { loadConfig } = await import("../settings/config");
    await loadConfig();
    try {
      const { regenerateFeedbackFile } = await import("../feedback/exportFile");
      await regenerateFeedbackFile();
    } catch (err) {
      console.error("Could not regenerate FEEDBACK.md at start-up; it will be written on the next change.", err);
    }
    const runtime = {
      pid: process.pid,
      port: hello.port,
      secret: hello.secret,
      startedAt: new Date().toISOString(),
      appVersion: hello.appVersion,
      schemaLevel,
      store: getPglite() ? "pglite" : "pg",
    };
    writeFileSync(/*turbopackIgnore: true*/ runtimeFilePath(dataDir), JSON.stringify(runtime, null, 2), { mode: 0o600 });
    setHostInfo(hello, schemaLevel);
    bridge.emit("ready", { port: hello.port, schemaLevel });
  } catch (err) {
    if (err instanceof StartupBlocked) {
      bridge.emit("blocked", { screen: err.screen, detail: err.message });
      return;
    }
    console.error("Start-up failed", err);
    bridge.emit("fatal", { message: err instanceof Error ? err.message : String(err) });
  }
}

