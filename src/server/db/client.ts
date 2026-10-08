import { PGlite, types as pgliteTypes } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { Kysely, PGliteDialect, type Transaction } from "kysely";
import path from "node:path";
import type { Database } from "./schema";
import { acquireStoreLock, releaseStoreLock } from "./storeLock";

export type DB = Kysely<Database>;
export type Trx = Transaction<Database>;

/**
 * Where the data lives (feature 11, data-model.md §1): PGlite (Postgres in WASM, in this process)
 * in a data folder, or in memory for tests. The Postgres server is gone since the cut-over (T078).
 */
export type StoreTarget = { kind: "pglite"; dataDir: string | "memory://" };

const globalForDb = globalThis as unknown as { __farabiDb?: DB; __farabiPglite?: { pglite: PGlite; dataDir: string } };

/** PGlite's parsers, kept as they were under `pg` so values didn't change at the cut-over (gate G3). */
const PGLITE_PARSERS = {
  // pg leaves int8 (count(*), bigint) as a string; PGlite would give a number.
  [pgliteTypes.INT8]: (value: string) => value,
};

function openPglite(dataDir: string | "memory://"): PGlite {
  // `relaxedDurability` stays off (research R2). With no dataDir, PGlite runs in memory.
  return new PGlite({
    // Runtime paths: without turbopackIgnore, Turbopack globs `**/store*` across the project into the bundle.
    ...(dataDir === "memory://" ? {} : { dataDir: path.join(/*turbopackIgnore: true*/ dataDir, "store") }),
    extensions: { vector },
    parsers: PGLITE_PARSERS,
  });
}

/** A store for `target`. */
export function createDb(t: StoreTarget): DB {
  // A second opener on the same folder corrupts it (PGlite issue #1106): lock first.
  if (t.dataDir !== "memory://") acquireStoreLock(t.dataDir);
  const pglite = openPglite(t.dataDir);
  if (t.dataDir !== "memory://") globalForDb.__farabiPglite = { pglite, dataDir: t.dataDir };
  return new Kysely<Database>({ dialect: new PGliteDialect({ pglite }) });
}

/** The store this process uses: the data folder in FARABI_DATA_DIR (`memory://` in tests). */
export function storeTarget(): StoreTarget {
  const dataDir = process.env.FARABI_DATA_DIR;
  if (!dataDir) throw new Error("FARABI_DATA_DIR is not set: Farabi's data folder (the app and npm run dev:web set it)");
  return { kind: "pglite", dataDir };
}

function getDb(): DB {
  globalForDb.__farabiDb ??= createDb(storeTarget());
  return globalForDb.__farabiDb;
}

/** The open on-disk PGlite instance, if this process uses one (backups, snapshots). */
export function getPglite(): { pglite: PGlite; dataDir: string } | undefined {
  return globalForDb.__farabiPglite;
}

/**
 * Closes the process-wide store and releases the store lock. Safe to call more than once.
 * `keepLock` holds on to the lock while the store's files are copied or replaced (backups).
 */
export async function closeDb({ keepLock = false }: { keepLock?: boolean } = {}): Promise<void> {
  const instance = globalForDb.__farabiDb;
  const disk = globalForDb.__farabiPglite;
  globalForDb.__farabiDb = undefined;
  globalForDb.__farabiPglite = undefined;
  if (instance) await instance.destroy();
  if (disk) {
    if (!disk.pglite.closed) await disk.pglite.close();
    if (!keepLock) releaseStoreLock(disk.dataDir);
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
