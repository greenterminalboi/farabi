import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Loads .env.local then .env.example into process.env without overriding existing values. */
export function loadEnv(): void {
  for (const file of [".env.local", ".env.example"]) {
    const full = path.resolve(import.meta.dirname, "..", file);
    if (existsSync(full)) process.loadEnvFile(full);
  }
}

// ── Which data a script works on (feature 11, contracts/cli.md) ─────────────────────────────────

export type Target =
  | { kind: "pg"; url: string }
  | { kind: "live"; dataDir: string; baseUrl: string; secret: string; pid: number }
  | { kind: "closed"; dataDir: string };

/** Where the installed app keeps its data (data-model.md §2, Tauri's app_data_dir for app.farabi). */
export function defaultDataDir(platform: NodeJS.Platform = process.platform, env: Record<string, string | undefined> = process.env, home = os.homedir()): string {
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "app.farabi");
  if (platform === "win32") return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "app.farabi");
  return path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "app.farabi");
}

export type ResolveDeps = { argv: string[]; env: Record<string, string | undefined>; pidAlive: (pid: number) => boolean; readFile: (p: string) => string | null };

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

const defaultDeps = (): ResolveDeps => ({
  argv: process.argv.slice(2),
  env: process.env,
  pidAlive,
  readFile: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
});

/**
 * Resolution order: `--data-dir <path>` (a desktop data folder, even when DATABASE_URL is set),
 * then DATABASE_URL (Postgres, until cut-over), then FARABI_DATA_DIR or the platform default. A
 * data folder whose runtime.json names a live process is the running app (HTTP with its bearer
 * secret); otherwise the store is opened directly.
 */
export function resolveTarget(deps: ResolveDeps = defaultDeps()): Target {
  const i = deps.argv.indexOf("--data-dir");
  const explicit = i >= 0 ? deps.argv[i + 1] : undefined;
  if (i >= 0 && !explicit) throw new Error("--data-dir needs a folder");
  if (!explicit && deps.env.DATABASE_URL) return { kind: "pg", url: deps.env.DATABASE_URL };
  const dataDir = path.resolve(explicit || deps.env.FARABI_DATA_DIR || defaultDataDir(undefined, deps.env));
  const raw = deps.readFile(path.join(dataDir, "runtime.json"));
  if (raw) {
    try {
      const rt = JSON.parse(raw) as { pid?: number; port?: number; secret?: string };
      if (typeof rt.pid === "number" && typeof rt.port === "number" && typeof rt.secret === "string" && deps.pidAlive(rt.pid)) {
        return { kind: "live", dataDir, baseUrl: `http://127.0.0.1:${rt.port}`, secret: rt.secret, pid: rt.pid };
      }
    } catch {
      // A torn or stale file: treat the store as closed.
    }
  }
  return { kind: "closed", dataDir };
}

/** `--test` keeps targeting the test database; otherwise resolveTarget(). */
export function scriptTarget(useTest: boolean): Target {
  if (!useTest) return resolveTarget();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  process.env.DATABASE_URL = url;
  return { kind: "pg", url };
}

/** Arguments without `--data-dir <path>`, for scripts that read positional arguments. */
export function scriptArgs(argv = process.argv.slice(2)): string[] {
  const i = argv.indexOf("--data-dir");
  return i >= 0 ? [...argv.slice(0, i), ...argv.slice(i + 2)] : argv;
}

export const QUIT_FIRST = "Quit Farabi first; it migrates its own data on start.";

/** A call to the running app, with its bearer secret. */
export async function callLive(target: Extract<Target, { kind: "live" }>, method: string, route: string, body?: unknown): Promise<Response> {
  return fetch(`${target.baseUrl}${route}`, {
    method,
    headers: { authorization: `Bearer ${target.secret}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * Points this process's `db` at the target and runs the matching branch. A closed desktop store is
 * opened as the app would (FARABI_HOST=tauri: attachments in the data folder, no env settings),
 * under its lock. `refuseWhenLive` makes a running app exit 2 with that message. Returns the exit code.
 */
export async function withTarget(opts: {
  refuseWhenLive?: string;
  live?: (target: Extract<Target, { kind: "live" }>) => Promise<number>;
  store: (target: Exclude<Target, { kind: "live" }>) => Promise<number>;
  target?: Target;
}): Promise<number> {
  const target = opts.target ?? resolveTarget();
  if (target.kind === "live") {
    if (opts.refuseWhenLive || !opts.live) {
      console.error(opts.refuseWhenLive ?? QUIT_FIRST);
      return 2;
    }
    return opts.live(target);
  }
  if (target.kind === "closed") {
    delete process.env.DATABASE_URL;
    process.env.FARABI_DATA_DIR = target.dataDir;
    process.env.FARABI_HOST = "tauri";
  }
  const { closeDb } = await import("../src/server/db/client");
  const { StoreLockedError } = await import("../src/server/db/storeLock");
  try {
    if (target.kind === "closed") {
      const { loadConfig } = await import("../src/server/settings/config");
      // A store that was never opened has no settings table yet; the defaults apply.
      await loadConfig().catch(() => undefined);
    }
    return await opts.store(target);
  } catch (err) {
    if (err instanceof StoreLockedError) {
      console.error(`The data is in use by another process (${err.holder.pid}). ${QUIT_FIRST}`);
      return 2;
    }
    throw err;
  } finally {
    await closeDb();
  }
}
