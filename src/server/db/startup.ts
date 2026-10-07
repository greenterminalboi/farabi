// Desktop mode start-up and shutdown (feature 11, data-model.md §6): handshake with the shell,
// open the store under its lock, refuse data from a newer Farabi, migrate, write runtime.json, then
// tell the shell the server is ready. Shutdown stops replies the way Stop does and closes the store.
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sql } from "kysely";
import { Migrator } from "kysely/migration";
import { type Hello, startBridge } from "../host/bridge";
import { installLogRedaction, registerSecret } from "../host/redact";
import { setSession } from "../host/session";
import { closeDb, db, getPglite } from "./client";
import { MIGRATIONS, migrationProvider } from "./migrationList";
import { StoreLockedError } from "./storeLock";

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

export const runtimeFilePath = (dataDir: string) => path.join(dataDir, "runtime.json");

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
 */
export async function prepareStore(hooks: { beforeMigrate?: (pending: string[]) => Promise<void> } = {}): Promise<string> {
  let executed: string[];
  try {
    executed = await executedMigrations();
  } catch (err) {
    if (err instanceof StoreLockedError) throw new StartupBlocked("store-locked", err.message);
    throw err;
  }
  const known = new Set(Object.keys(MIGRATIONS));
  const unknown = executed.filter((name) => !known.has(name));
  if (unknown.length) {
    throw new StartupBlocked("newer-data", `This data includes ${unknown.join(", ")}, which this version of Farabi doesn't know.`);
  }
  const pending = Object.keys(MIGRATIONS).filter((name) => !executed.includes(name));
  if (pending.length) {
    await hooks.beforeMigrate?.(pending);
    const { error } = await new Migrator({ db, provider: migrationProvider }).migrateToLatest();
    if (error) throw error;
  }
  return Object.keys(MIGRATIONS).sort().at(-1) ?? "";
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
      await closeDb();
    } finally {
      rmSync(runtimeFilePath(dataDir), { force: true });
    }
  })();
  return shuttingDown;
}

/** The whole desktop start-up, run from instrumentation.ts when FARABI_HOST=tauri. */
export async function desktopStartup(): Promise<void> {
  installLogRedaction();
  const bridge = startBridge(process.stdin, process.stdout);
  const hello: Hello = await bridge.hello;
  setSession({ secret: hello.secret, port: hello.port });
  registerSecret(hello.secret);
  const dataDir = process.env.FARABI_DATA_DIR || hello.dataDir;
  process.env.FARABI_DATA_DIR = dataDir;
  // Until T066 moves attachments into the data folder, keep feedback files out of the app bundle.
  process.env.FEEDBACK_DIR ||= path.join(dataDir, "feedback");

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
    const schemaLevel = await prepareStore();
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
    writeFileSync(runtimeFilePath(dataDir), JSON.stringify(runtime, null, 2), { mode: 0o600 });
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

