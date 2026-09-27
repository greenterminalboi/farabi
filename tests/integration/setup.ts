import { promises as fs } from "node:fs";
import path from "node:path";
import { sql } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { loadEnv } from "../../scripts/env";

loadEnv();
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.AI_PROVIDER = "fake";
process.env.SUMMARY_TRIGGER = "reply"; // tests expect labels after each reply, whatever .env.local says

const { db } = await import("@/server/db/client");
const { setFakeMode } = await import("@/server/ai/fake");
const { drainSummaries } = await import("@/server/summaries/queue");
const { drainGenerations } = await import("@/server/messages/generation");
const { drainDrafts } = await import("@/server/definitions/draftQueue");
const { resetFakeCalls } = await import("@/server/ai/fake");

beforeAll(async () => {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.resolve(import.meta.dirname, "../../src/server/db/migrations"),
    }),
  });
  const { error } = await migrator.migrateToLatest();
  if (error) throw error;
});

beforeEach(async () => {
  await drainGenerations();
  await drainSummaries();
  await drainDrafts();
  resetFakeCalls();
  await sql`TRUNCATE definition_versions, definitions, edge_label_versions, node_summaries, branch_markers, messages, nodes, trees RESTART IDENTITY CASCADE`.execute(db);
  setFakeMode({ mode: "ok" });
});

afterAll(async () => {
  await drainGenerations();
  await drainSummaries();
});
