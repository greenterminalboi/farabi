// `npm run db:migrate`: runs pending migrations in one transaction (research R3).
// Before 0010_message_graph runs on a database that holds v1 data, it takes a backup with pg_dump
// through `docker compose` into db/backups/ and refuses to migrate if that fails, unless
// `--no-backup` is given (FR-063). `--test` targets the test database and skips the backup.
// A desktop data folder (feature 11, contracts/cli.md) is migrated the way the app does it on
// start: a verified copy of the closed store first, restored if a migration fails. While the app
// is running on it, this refuses (exit 2).
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sql } from "kysely";
import { Migrator } from "kysely/migration";
import { createDb } from "../src/server/db/client";
import { migrationProvider } from "../src/server/db/migrationList";
import { loadEnv, QUIT_FIRST, scriptTarget, withTarget } from "./env";

loadEnv();
const useTest = process.argv.includes("--test");
const noBackup = process.argv.includes("--no-backup");
const target = scriptTarget(useTest);
if (target.kind !== "pg") {
  process.exit(
    await withTarget({
      target,
      refuseWhenLive: QUIT_FIRST,
      store: async () => {
        const { prepareStore, StartupBlocked } = await import("../src/server/db/startup");
        try {
          console.log(`Up to date at ${await prepareStore()}.`);
          return 0;
        } catch (err) {
          if (!(err instanceof StartupBlocked)) throw err;
          console.error(err.message);
          return 1;
        }
      },
    }),
  );
}
const url = target.url;

const db = createDb(url);
const migrator = new Migrator({ db, provider: migrationProvider });

/** 0010 is pending, and the old conversation tables hold rows. */
async function needsBackup(): Promise<boolean> {
  const pending = (await migrator.getMigrations()).some((m) => m.name === "0010_message_graph" && !m.executedAt);
  if (!pending) return false;
  const { rows: table } = await sql<{ t: string | null }>`SELECT to_regclass('public.messages')::text AS t`.execute(db);
  if (!table[0].t) return false;
  const { rows } = await sql<{ n: number }>`SELECT count(*)::int AS n FROM (SELECT 1 FROM public.messages LIMIT 1) x`.execute(db);
  return rows[0].n > 0;
}

/**
 * pg_dump in custom format, by whichever route this machine has: the compose service, a local
 * pg_dump, or pg_dump from the project's Postgres image reaching the host database.
 */
function dumpDatabase(): Buffer {
  const { username, pathname } = new URL(url);
  const dbName = pathname.slice(1) || "farabi";
  const routes: Array<[string, string[]]> = [
    ["docker", ["compose", "exec", "-T", "db", "pg_dump", "-Fc", "-U", username || "farabi", dbName]],
    ["pg_dump", ["-Fc", url]],
    ["docker", ["run", "--rm", "pgvector/pgvector:pg17", "pg_dump", "-Fc", url.replace(/@(127\.0\.0\.1|localhost)([:/])/, "@host.docker.internal$2")]],
  ];
  const failures: string[] = [];
  for (const [cmd, args] of routes) {
    try {
      const dump = execFileSync(cmd, args, {
        cwd: path.resolve(import.meta.dirname, ".."),
        maxBuffer: 1024 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (dump.length > 0) return dump;
      failures.push(`${cmd} ${args[0]}: empty output`);
    } catch (err) {
      failures.push(`${cmd} ${args[0]}: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
    }
  }
  throw new Error(`pg_dump failed every way it was tried:\n  ${failures.join("\n  ")}`);
}

function backup(): string {
  const dir = path.resolve(import.meta.dirname, "../db/backups");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-pre-0010.dump`);
  writeFileSync(file, dumpDatabase());
  if (statSync(file).size === 0) throw new Error(`The backup ${file} is empty`);
  return file;
}

try {
  if (!useTest && (await needsBackup())) {
    if (noBackup) console.log("Skipping the backup before 0010 (--no-backup).");
    else {
      try {
        console.log(`Backed up to ${backup()}`);
      } catch (err) {
        console.error("Couldn't back up the database before migration 0010, so nothing was changed.");
        console.error(err instanceof Error ? err.message : err);
        console.error("Fix the backup (is `docker compose up -d` running?), or rerun with --no-backup.");
        process.exitCode = 1;
      }
    }
  }
  if (!process.exitCode) {
    const { error, results } = await migrator.migrateToLatest();
    for (const r of results ?? []) console.log(`${r.status}: ${r.migrationName}`);
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  }
} finally {
  await db.destroy();
}
