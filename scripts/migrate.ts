import { Migrator } from "kysely/migration";
import { createDb } from "../src/server/db/client";
import { migrationProvider } from "../src/server/db/migrationList";
import { loadEnv } from "./env";

loadEnv();
const useTest = process.argv.includes("--test");
const url = useTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
if (!url) throw new Error(`${useTest ? "TEST_DATABASE_URL" : "DATABASE_URL"} is not set`);

const db = createDb(url);
const migrator = new Migrator({ db, provider: migrationProvider });

const { error, results } = await migrator.migrateToLatest();
for (const r of results ?? []) console.log(`${r.status}: ${r.migrationName}`);
await db.destroy();
if (error) {
  console.error(error);
  process.exit(1);
}
