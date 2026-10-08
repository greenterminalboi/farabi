// The one-time import of the web app's database (feature 11, US3, FR-017). The source is the
// Postgres test database, filled through the app's own routes; the destination is a fresh
// in-memory PGlite store. Runs only on Postgres (STORE=pg), which provides the source.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "kysely";
import { Migrator } from "kysely/migration";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, db, type DB } from "@/server/db/client";
import { checkImport, ImportFailed, ImportRefused, runImport } from "@/server/db/importWeb";
import { MIGRATIONS, migrationProvider } from "@/server/db/migrationList";
import { feedbackDir } from "@/server/feedback/paths";
import { PNG_1PX } from "./fixtures";
import { seedV1 } from "./fixtures";
import { call, createFeedback, newProject, startTree } from "./helpers";

const onPg = process.env.STORE !== "pglite" && Boolean(process.env.TEST_DATABASE_URL);
const SOURCE = process.env.TEST_DATABASE_URL!;

/** Every table's rows as text, in key order: what "equal" means for the import. */
async function snapshot(q: DB): Promise<Record<string, string[]>> {
  const { rows: tables } = await sql<{ t: string; key: string }>`
    SELECT n.nspname || '.' || c.relname AS t,
      coalesce((SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY array_position(i.indkey, a.attnum)) FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey) WHERE i.indrelid = c.oid AND i.indisprimary), 't::text') AS key
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname IN ('public', 'v1') AND c.relname NOT IN ('kysely_migration', 'kysely_migration_lock', 'import_runs')
    ORDER BY 1`.execute(q);
  await sql`SET TIME ZONE 'UTC'`.execute(q);
  const out: Record<string, string[]> = {};
  for (const { t, key } of tables) {
    const { rows } = await sql.raw<{ r: string }>(`SELECT t::text AS r FROM ${t} t ORDER BY ${key}`).execute(q);
    out[t] = rows.map((r) => r.r);
  }
  return out;
}

async function freshDestination(): Promise<DB> {
  const dest = createDb({ kind: "pglite", dataDir: "memory://" });
  const { error } = await new Migrator({ db: dest, provider: migrationProvider }).migrateToLatest();
  if (error) throw error;
  return dest;
}

/** Realistic data in every kind of table, through the app's routes. */
async function seedSource(): Promise<{ itemId: string }> {
  const projectId = await newProject("Imported project");
  const t = await startTree(projectId, "What are pods?");
  await call("POST", `/api/nodes/${t.answer.id}/ask?wait=1`, { content: "And nodes?" });
  const span = { start: 0, end: 4, text: String(t.answer.text).slice(0, 4) };
  await call("POST", `/api/nodes/${t.answer.id}/branches`, span);
  await call("POST", `/api/nodes/${t.answer.id}/parked`, { ...span, question: "Later" });
  await call("PUT", `/api/edges/${t.edge.id}/note`, { text: "builds on" });
  await call("PUT", "/api/settings", { informationPressure: 3 });
  await call("POST", "/api/definitions", { nodeId: t.answer.id, ...span });
  const fb = await createFeedback({ text: "Imported feedback", view: "canvas", projectId, tags: ["ui"], images: [{ bytes: PNG_1PX }] });
  // A v1 leftover, as on a converted database.
  const tree = crypto.randomUUID();
  const node = crypto.randomUUID();
  await seedV1({
    trees: [{ id: tree, project_id: projectId, root_node_id: node, layout_origin_x: 0, layout_origin_y: 0, user_placed: false, created_at: new Date("2026-09-01T09:00:00.123456Z") }],
    nodes: [{ id: node, tree_id: tree, parent_id: null, provenance: "user_authored", manual_x: null, manual_y: null, kind: "conversation", origin: "root", function_id: null, function_version: null, created_at: new Date("2026-09-01T09:00:00Z") }],
  });
  return { itemId: fb.body.item.id };
}

describe.runIf(onPg)("Feature 11 · US3 import from the web app", () => {
  let dest: DB;
  let attachmentsTo: string;
  beforeEach(async () => {
    dest = await freshDestination();
    attachmentsTo = mkdtempSync(path.join(os.tmpdir(), "farabi-import-"));
  });
  afterEach(async () => {
    await dest.destroy();
    rmSync(attachmentsTo, { recursive: true, force: true });
  });

  it("checks, then copies every table exactly, with the attachment files", async () => {
    const { itemId } = await seedSource();
    // First launch made an empty default project; that still counts as empty.
    await dest.insertInto("projects").values({ name: "My first project" }).execute();
    await dest.insertInto("setting_changes").values({ key: "ai_provider", value: JSON.stringify("claude-code") }).execute();

    const check = await checkImport({ connectionString: SOURCE, dest });
    expect(check.ready).toBe(true);
    if (!check.ready) return;
    expect(check.counts["public.nodes"]).toBeGreaterThan(3);
    expect(check.counts["v1.trees"]).toBe(1);

    const result = await runImport({ connectionString: SOURCE, attachmentsDir: feedbackDir(), dest, attachmentsTo });
    expect(result).toMatchObject({ outcome: "succeeded", checksumsMatch: true, attachmentsCopied: 1 });

    const source = await snapshot(db);
    const imported = await snapshot(dest);
    const { ["public.setting_changes"]: srcSettings, ...srcRest } = source;
    const { ["public.setting_changes"]: dstSettings, ...dstRest } = imported;
    expect(dstRest).toEqual(srcRest);
    // The desktop app's own settings are kept beside the imported ones.
    expect(dstSettings).toEqual(expect.arrayContaining(srcSettings));
    expect(dstSettings).toHaveLength(srcSettings.length + 1);
    expect(imported["public.nodes"].join()).toContain("user_authored");

    const files = path.join(attachmentsTo, "attachments", itemId);
    expect(existsSync(files)).toBe(true);
    const run = await dest.selectFrom("import_runs").selectAll().executeTakeFirstOrThrow();
    expect(run).toMatchObject({ outcome: "succeeded", checksums_match: true, error: null, provenance: "user_authored" });
    expect(run.source_label).not.toContain(":farabi@");
    expect(run.source_label).toContain("farabi@127.0.0.1");
    expect(readFileSync(path.join(files, (await import("node:fs")).readdirSync(files).find((n) => n.endsWith(".png"))!))).toEqual(Buffer.from(PNG_1PX));

    // Importing again is refused, whatever the destination holds.
    const again = await checkImport({ connectionString: SOURCE, dest });
    expect(again).toMatchObject({ ready: false, reason: "already_imported" });
    await expect(runImport({ connectionString: SOURCE, dest })).rejects.toBeInstanceOf(ImportRefused);
  });

  it("refuses a destination that already has work in it", async () => {
    await seedSource();
    const projectId = (await dest.insertInto("projects").values({ name: "Mine" }).returning("id").executeTakeFirstOrThrow()).id;
    await dest.insertInto("trees").values({ project_id: projectId, layout_origin_x: 0, layout_origin_y: 0 }).execute();
    expect(await checkImport({ connectionString: SOURCE, dest })).toMatchObject({ ready: false, reason: "destination_not_empty" });
  });

  it("refuses a source behind or ahead of this version's migrations", async () => {
    const last = Object.keys(MIGRATIONS).sort().at(-1)!;
    await sql`DELETE FROM kysely_migration WHERE name = ${last}`.execute(db);
    try {
      expect(await checkImport({ connectionString: SOURCE, dest })).toMatchObject({ ready: false, reason: "schema_behind" });
    } finally {
      await sql`INSERT INTO kysely_migration (name, timestamp) VALUES (${last}, now()::text)`.execute(db);
    }
    await sql`INSERT INTO kysely_migration (name, timestamp) VALUES ('0999_future', now()::text)`.execute(db);
    try {
      expect(await checkImport({ connectionString: SOURCE, dest })).toMatchObject({ ready: false, reason: "schema_ahead" });
    } finally {
      await sql`DELETE FROM kysely_migration WHERE name = '0999_future'`.execute(db);
    }
  });

  it("refuses an unreachable source", async () => {
    const res = await checkImport({ connectionString: "postgres://farabi:farabi@127.0.0.1:1/farabi", dest });
    expect(res).toMatchObject({ ready: false, reason: "source_unreachable" });
  });

  it("rolls back everything when the copy fails part-way, and records the failure", async () => {
    await seedSource();
    const before = await snapshot(dest);
    const err = await runImport({ connectionString: SOURCE, attachmentsDir: feedbackDir(), dest, attachmentsTo, failAfterTables: 3 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImportFailed);
    // Exactly as before: a new store's own rows (0010's v1 checksums) included.
    expect(await snapshot(dest)).toEqual(before);
    const runs = await dest.selectFrom("import_runs").selectAll().execute();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ outcome: "failed", checksums_match: null });
    expect(runs[0].error).toMatch(/Injected failure after 3 tables/);
    expect(existsSync(path.join(attachmentsTo, "attachments"))).toBe(false);
    // A failed attempt doesn't count as imported.
    expect((await checkImport({ connectionString: SOURCE, dest })).ready).toBe(true);
  });
});
