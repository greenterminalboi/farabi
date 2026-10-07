import { promises as fs, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "kysely";
import { Migrator } from "kysely/migration";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { loadEnv } from "../../scripts/env";

loadEnv();
// STORE=pglite runs the suite on an in-memory PGlite per test file, with no Postgres needed;
// STORE=pg (the default until cut-over) uses TEST_DATABASE_URL (feature 11, gate G3).
if (process.env.STORE === "pglite") {
  delete process.env.DATABASE_URL;
  process.env.FARABI_DATA_DIR = "memory://";
} else {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
process.env.AI_PROVIDER = "fake";
// Feedback files go to a throwaway folder, never the real feedback/ (research R11).
process.env.FEEDBACK_DIR = mkdtempSync(path.join(os.tmpdir(), "farabi-feedback-"));

const { db } = await import("@/server/db/client");
const { TRUNCATE_TABLES } = await import("./fixtures");
const { setFakeMode } = await import("@/server/ai/fake");
const { drainGenerations } = await import("@/server/answers/generation");
const { drainDrafts } = await import("@/server/definitions/draftQueue");
const { resetFakeCalls } = await import("@/server/ai/fake");

beforeAll(async () => {
  const { migrationProvider } = await import("@/server/db/migrationList");
  const migrator = new Migrator({ db, provider: migrationProvider });
  const { error } = await migrator.migrateToLatest();
  if (error) throw error;
});

beforeEach(async () => {
  await drainGenerations();
  await drainDrafts();
  resetFakeCalls();
  // v2 tables, the live tables, and the frozen v1 tables that conversion tests seed. TRUNCATE
  // fires no row triggers, so the append-only and frozen guards don't get in the way.
  await sql`TRUNCATE ${sql.raw(TRUNCATE_TABLES.join(", "))} RESTART IDENTITY CASCADE`.execute(db);
  setFakeMode({ mode: "ok" });
  // The throwaway feedback folder follows the database: empty before each test.
  await fs.rm(process.env.FEEDBACK_DIR!, { recursive: true, force: true });
  await fs.mkdir(process.env.FEEDBACK_DIR!, { recursive: true });
});

afterAll(async () => {
  await drainGenerations();
});
