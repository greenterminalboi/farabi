import { promises as fs, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { loadEnv } from "../../scripts/env";

loadEnv();
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.AI_PROVIDER = "fake";
process.env.SUMMARY_TRIGGER = "reply"; // tests expect labels after each reply, whatever .env.local says
// Feedback files go to a throwaway folder, never the real feedback/ (research R11).
process.env.FEEDBACK_DIR = mkdtempSync(path.join(os.tmpdir(), "farabi-feedback-"));

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
  await sql`TRUNCATE feedback_state_events, feedback_attachments, feedback_tags, feedback_items, definition_versions, definitions, edge_label_versions, node_summaries, branch_markers, messages, nodes, trees, projects RESTART IDENTITY CASCADE`.execute(db);
  setFakeMode({ mode: "ok" });
  // The throwaway feedback folder follows the database: empty before each test.
  await fs.rm(process.env.FEEDBACK_DIR!, { recursive: true, force: true });
  await fs.mkdir(process.env.FEEDBACK_DIR!, { recursive: true });
});

afterAll(async () => {
  await drainGenerations();
  await drainSummaries();
});
