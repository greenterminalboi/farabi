// Test-only server hooks (feature 11 cut-over): e2e drives the real app, whose store is in-process,
// so resets and seeds go through these instead of a database connection. They exist only when
// FARABI_TEST_HOOKS=1, never merely in development: a reset empties every table.
import { sql } from "kysely";
import { rm } from "node:fs/promises";
import { db } from "../db/client";

export const testHooksEnabled = () => process.env.FARABI_TEST_HOOKS === "1";

/** Empties every table (not the migration records), as a fresh store, and the attachment folder. */
export async function resetStore(): Promise<void> {
  const { drainGenerations } = await import("../answers/generation");
  const { drainDrafts } = await import("../definitions/draftQueue");
  await drainGenerations();
  await drainDrafts();
  const { rows } = await sql<{ t: string }>`
    SELECT quote_ident(n.nspname) || '.' || quote_ident(c.relname) AS t
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname IN ('public', 'v1') AND c.relname NOT LIKE 'kysely_migration%'`.execute(db);
  // TRUNCATE fires no row triggers, so the append-only guards don't get in the way.
  await sql.raw(`TRUNCATE ${rows.map((r) => r.t).join(", ")} RESTART IDENTITY CASCADE`).execute(db);
  const { resetConfigCache, loadConfig } = await import("../settings/config");
  resetConfigCache();
  await loadConfig();
  const { setFakeMode, resetFakeCalls } = await import("../ai/fake");
  setFakeMode({ mode: "ok" });
  resetFakeCalls();
  const { feedbackDir } = await import("../feedback/paths");
  await rm(/*turbopackIgnore: true*/ feedbackDir(), { recursive: true, force: true });
}
