import { Kysely, PostgresDialect, type Transaction } from "kysely";
import pg from "pg";
import type { Database } from "./schema";

export type DB = Kysely<Database>;
export type Trx = Transaction<Database>;

// pg returns `real` as a string by default; map it to a number.
pg.types.setTypeParser(700, (value) => Number.parseFloat(value));

const globalForDb = globalThis as unknown as { __farabiDb?: DB };

export function createDb(connectionString: string): DB {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max: 10 }) }),
  });
}

function getDb(): DB {
  if (!globalForDb.__farabiDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.__farabiDb = createDb(url);
  }
  return globalForDb.__farabiDb;
}

/** Lazily created, cached on globalThis so Next.js hot reload reuses the pool. */
export const db: DB = new Proxy({} as DB, {
  get(_target, prop) {
    const instance = getDb();
    const value = Reflect.get(instance, prop, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
