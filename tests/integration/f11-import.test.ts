// The one-time import of the web app's database (feature 11, US3, FR-017), as a round trip: data
// is made through the app's own routes (in this suite's store), copied into a scratch Postgres
// database as the web app would have held it, imported into a fresh in-memory store, and compared. Since the cut-over there is no Postgres in the project, so this runs only
// when IMPORT_SOURCE_URL names a Postgres database it may fill and empty (a scratch database).
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "kysely";
import { Kysely, PostgresDialect } from "kysely";
import { Migrator } from "kysely/migration";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, db, type DB } from "@/server/db/client";
import { checkImport, ImportFailed, ImportRefused, runImport } from "@/server/db/importWeb";
import { MIGRATIONS, migrationProvider } from "@/server/db/migrationList";
import { feedbackDir } from "@/server/feedback/paths";
import { PNG_1PX } from "./fixtures";
import { seedV1 } from "./fixtures";
import { call, createFeedback, newProject, startTree } from "./helpers";

const SOURCE = process.env.IMPORT_SOURCE_URL ?? "";
const onPg = Boolean(SOURCE);

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

/** The scratch Postgres database, as a fresh web-app database at this schema level (or `level`). */
async function resetSource(level?: string): Promise<DB> {
  await src?.destroy();
  src = new Kysely<never>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: SOURCE, max: 2 }) }) }) as unknown as DB;
  await sql`DROP SCHEMA IF EXISTS v1 CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public`.execute(src);
  const migrator = new Migrator({ db: src, provider: migrationProvider });
  const { error } = level ? await migrator.migrateTo(level) : await migrator.migrateToLatest();
  if (error) throw error;
  return src;
}

/** Copies every row of this suite's store into the source, column for column (the source's columns). */
async function publishToSource(src: DB): Promise<void> {
  const { rows: tables } = await sql<{ t: string; cols: string }>`
    SELECT quote_ident(n.nspname) || '.' || quote_ident(c.relname) AS t,
      (SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '') AS cols
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname IN ('public', 'v1') AND c.relname NOT IN ('kysely_migration', 'kysely_migration_lock')`.execute(src);
  await src.transaction().execute(async (trx) => {
    await sql`SET LOCAL session_replication_role = replica`.execute(trx);
    await sql.raw(`TRUNCATE ${tables.map((t) => t.t).join(", ")}`).execute(trx);
    for (const { t, cols } of tables) {
      const { rows } = await sql.raw<{ j: string }>(`SELECT coalesce(json_agg(row_to_json(farabi_row)), '[]')::text AS j FROM ${t} farabi_row`).execute(db);
      if (rows[0].j === "[]") continue;
      await sql
        .raw(`INSERT INTO ${t} (${cols}) OVERRIDING SYSTEM VALUE SELECT ${cols} FROM json_populate_recordset(NULL::${t}, '${rows[0].j.replace(/'/g, "''")}'::json)`)
        .execute(trx);
    }
  });
}

async function freshDestination(): Promise<DB> {
  const dest = createDb({ kind: "pglite", dataDir: "memory://" });
  const { error } = await new Migrator({ db: dest, provider: migrationProvider }).migrateToLatest();
  if (error) throw error;
  return dest;
}

let src: DB;

/** Realistic data in every kind of table, through the app's routes, then copied to the source. */
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
  await publishToSource(src);
  return { itemId: fb.body.item.id };
}

describe.runIf(onPg)("Feature 11 · US3 import from the web app", { timeout: 120_000 }, () => {
  let dest: DB;
  let attachmentsTo: string;
  beforeAll(async () => {
    await resetSource();
  });
  afterAll(async () => {
    await src?.destroy();
  });
  beforeEach(async () => {
    await publishToSource(src);
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
    // The password is stripped: no `user:password@` left.
    expect(run.source_label).not.toMatch(/:\/\/[^/@]*:[^/@]*@/);
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

  it("imports a source from an older Farabi, upgrading the copy, and refuses a newer one", async () => {
    const names = Object.keys(MIGRATIONS).sort();
    const older = names.at(-2)!;
    await resetSource(older);
    const { itemId } = await seedSource();
    try {
      const check = await checkImport({ connectionString: SOURCE, dest });
      expect(check).toMatchObject({ ready: true, upgradeFrom: older });
      const result = await runImport({ connectionString: SOURCE, attachmentsDir: feedbackDir(), dest, attachmentsTo });
      expect(result).toMatchObject({ outcome: "succeeded", checksumsMatch: true });
      // The upgraded copy equals what this Farabi made itself (the app's own settings aside).
      const { ["public.setting_changes"]: _a, ...made } = await snapshot(db);
      const { ["public.setting_changes"]: _b, ...imported } = await snapshot(dest);
      expect(imported).toEqual(made);
      expect(existsSync(path.join(attachmentsTo, "attachments", itemId))).toBe(true);
      const run = await dest.selectFrom("import_runs").select("schema_level").executeTakeFirstOrThrow();
      expect(run.schema_level).toBe(`${older} → ${names.at(-1)}`);
      // The source itself was only read.
      const { rows } = await sql<{ name: string }>`SELECT name FROM kysely_migration ORDER BY name`.execute(src);
      expect(rows.at(-1)!.name).toBe(older);
    } finally {
      await resetSource();
    }
    await sql`INSERT INTO kysely_migration (name, timestamp) VALUES ('0999_future', now()::text)`.execute(src);
    expect(await checkImport({ connectionString: SOURCE, dest })).toMatchObject({ ready: false, reason: "schema_ahead" });
    await sql`DELETE FROM kysely_migration WHERE name = '0999_future'`.execute(src);
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
