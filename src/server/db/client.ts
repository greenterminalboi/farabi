import { PGlite, types as pgliteTypes } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { Kysely, PGliteDialect, PostgresDialect, type Transaction } from "kysely";
import path from "node:path";
import pg from "pg";
import type { Database } from "./schema";
import { acquireStoreLock, releaseStoreLock } from "./storeLock";

export type DB = Kysely<Database>;
export type Trx = Transaction<Database>;

// pg returns `real` as a string by default; map it to a number.
pg.types.setTypeParser(700, (value) => Number.parseFloat(value));

/**
 * Where the data lives (feature 11, data-model.md §1): Postgres for the web app until cut-over,
 * or PGlite (Postgres in WASM, in this process) in a data folder or in memory.
 */
export type StoreTarget = { kind: "pg"; url: string } | { kind: "pglite"; dataDir: string | "memory://" };

const globalForDb = globalThis as unknown as { __farabiDb?: DB; __farabiPglite?: { pglite: PGlite; dataDir: string } };

/** PGlite's parsers, set to give the same JS values as `pg` (gate G3). */
const PGLITE_PARSERS = {
  // pg leaves int8 (count(*), bigint) as a string; PGlite would give a number.
  [pgliteTypes.INT8]: (value: string) => value,
};

function openPglite(dataDir: string | "memory://"): PGlite {
  // `relaxedDurability` stays off (research R2). With no dataDir, PGlite runs in memory.
  return new PGlite({
    ...(dataDir === "memory://" ? {} : { dataDir: path.join(dataDir, "store") }),
    extensions: { vector },
    parsers: PGLITE_PARSERS,
  });
}

/** A store for `target`, or a Postgres URL (scripts written before feature 11 pass a string). */
export function createDb(target: StoreTarget | string): DB {
  const t: StoreTarget = typeof target === "string" ? { kind: "pg", url: target } : target;
  if (t.kind === "pg") {
    return new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: t.url, max: 10 }) }),
    });
  }
  // A second opener on the same folder corrupts it (PGlite issue #1106): lock first.
  if (t.dataDir !== "memory://") acquireStoreLock(t.dataDir);
  const pglite = openPglite(t.dataDir);
  if (t.dataDir !== "memory://") globalForDb.__farabiPglite = { pglite, dataDir: t.dataDir };
  return new Kysely<Database>({ dialect: new PGliteDialect({ pglite }) });
}

/** The store this process uses: PGlite in the desktop app, else Postgres when DATABASE_URL is set, else PGlite in FARABI_DATA_DIR. */
export function storeTarget(): StoreTarget {
  // The desktop app always uses its own data folder, even if a dev .env.local sets DATABASE_URL.
  if (process.env.FARABI_HOST === "tauri" && process.env.FARABI_DATA_DIR) {
    return { kind: "pglite", dataDir: process.env.FARABI_DATA_DIR };
  }
  if (process.env.DATABASE_URL) return { kind: "pg", url: process.env.DATABASE_URL };
  if (process.env.FARABI_DATA_DIR) return { kind: "pglite", dataDir: process.env.FARABI_DATA_DIR };
  throw new Error("DATABASE_URL is not set");
}

function getDb(): DB {
  globalForDb.__farabiDb ??= createDb(storeTarget());
  return globalForDb.__farabiDb;
}

/** The open on-disk PGlite instance, if this process uses one (backups, snapshots). */
export function getPglite(): { pglite: PGlite; dataDir: string } | undefined {
  return globalForDb.__farabiPglite;
}

/** Closes the process-wide store and releases the store lock. Safe to call more than once. */
export async function closeDb(): Promise<void> {
  const instance = globalForDb.__farabiDb;
  const disk = globalForDb.__farabiPglite;
  globalForDb.__farabiDb = undefined;
  globalForDb.__farabiPglite = undefined;
  if (instance) await instance.destroy();
  if (disk) {
    if (!disk.pglite.closed) await disk.pglite.close();
    releaseStoreLock(disk.dataDir);
  }
}

/** Lazily created, cached on globalThis so Next.js hot reload reuses the pool. */
export const db: DB = new Proxy({} as DB, {
  get(_target, prop) {
    const instance = getDb();
    const value = Reflect.get(instance, prop, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
