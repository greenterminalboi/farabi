// One-time import of the web app's Postgres database into the desktop store (feature 11, FR-017,
// research R11, data-model.md §4). All or nothing: one destination transaction, every row copied
// column for column with its ids, timestamps and provenance, checked by per-table checksums
// before commit. It never merges: a destination with work in it, or a source imported before, is
// refused. Each attempt leaves an append-only `import_runs` row.
import { promises as fs } from "node:fs";
import path from "node:path";
import { sql } from "kysely";
import pg from "pg";
import type { ImportCheckResponse, ImportRefusal, ImportResult } from "@/shared/desktop";
import { feedbackDir } from "../feedback/paths";
import { db as appDb, type DB, type Trx } from "./client";
import { MIGRATIONS } from "./migrationList";

export type ImportOptions = {
  connectionString: string;
  /** The web app's feedback folder, holding `attachments/<item>/…`. Optional. */
  attachmentsDir?: string;
  /** Tests only: throw after copying this many tables. */
  failAfterTables?: number;
  /** The store to import into (default: the app's own) and where attachment files go. */
  dest?: DB;
  attachmentsTo?: string;
};

export class ImportRefused extends Error {
  constructor(
    readonly reason: ImportRefusal,
    detail: string,
  ) {
    super(detail);
  }
}

export class ImportFailed extends Error {
  constructor(
    readonly runId: string,
    message: string,
  ) {
    super(message);
  }
}

const BATCH = 500;
/** Never copied: migration bookkeeping and the import's own record. */
const SKIP = new Set(["public.kysely_migration", "public.kysely_migration_lock", "public.import_runs"]);
/** Kept in the destination: the desktop app's own settings history (provider, export folder…). */
const KEEP_DESTINATION = new Set(["public.setting_changes"]);

type Table = { schema: string; name: string; full: string; columns: string[]; pk: string[] };

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const qualified = (t: Table) => `${ident(t.schema)}.${ident(t.name)}`;

/** The connection string without its password, for the record. */
export function sourceLabel(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    url.password = "";
    return url.toString().replace(/:@/, "@");
  } catch {
    return "(unparseable connection string)";
  }
}

/** The tables to copy, in foreign-key order, read from the destination's own catalog. */
async function tables(q: Trx | DB): Promise<Table[]> {
  const { rows } = await sql<{ schema: string; name: string; columns: string[]; pk: string[] | null }>`
    SELECT n.nspname AS schema, c.relname AS name,
      (SELECT array_agg(a.attname::text ORDER BY a.attnum) FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '') AS columns,
      (SELECT array_agg(a.attname::text ORDER BY array_position(i.indkey, a.attnum)) FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indrelid = c.oid AND i.indisprimary) AS pk
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname IN ('public', 'v1')
    ORDER BY 1, 2`.execute(q);
  const all = rows
    .map((r) => ({ schema: r.schema, name: r.name, full: `${r.schema}.${r.name}`, columns: r.columns, pk: r.pk ?? [] }))
    .filter((t) => !SKIP.has(t.full));
  const { rows: fks } = await sql<{ child: string; parent: string }>`
    SELECT cn.nspname || '.' || c.relname AS child, pn.nspname || '.' || p.relname AS parent
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace cn ON cn.oid = c.relnamespace
    JOIN pg_class p ON p.oid = k.confrelid JOIN pg_namespace pn ON pn.oid = p.relnamespace
    WHERE k.contype = 'f'`.execute(q);
  // Parents before children; ties keep catalog order.
  const parents = new Map(all.map((t) => [t.full, new Set<string>()]));
  for (const fk of fks) if (fk.child !== fk.parent && parents.has(fk.child) && parents.has(fk.parent)) parents.get(fk.child)!.add(fk.parent);
  const ordered: Table[] = [];
  const done = new Set<string>();
  while (ordered.length < all.length) {
    const next = all.find((t) => !done.has(t.full) && [...parents.get(t.full)!].every((p) => done.has(p)));
    // A cycle can't be ordered; with triggers off the copy still works, so take the rest as they come.
    const pick = next ?? all.find((t) => !done.has(t.full))!;
    ordered.push(pick);
    done.add(pick.full);
  }
  return ordered;
}

const orderBy = (t: Table) => (t.pk.length ? t.pk.map((c) => `t.${ident(c)}`).join(", ") : "t::text");

/** Rows per table and an md5 of every row's text in key order, on either side. */
async function digest(run: (text: string) => Promise<{ n: string; md5: string }>, t: Table) {
  return run(`SELECT count(*)::text AS n, md5(coalesce(string_agg(t::text, '|' ORDER BY ${orderBy(t)}), '')) AS md5 FROM ${qualified(t)} t`);
}

async function connectSource(connectionString: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query("SET TIME ZONE 'UTC'");
    await client.query("SET default_transaction_read_only = on");
  } catch (err) {
    await client.end().catch(() => undefined);
    throw new ImportRefused("source_unreachable", `Couldn't connect to the web app's database: ${err instanceof Error ? err.message : String(err)}`);
  }
  return client;
}

async function systemIdentifier(client: pg.Client): Promise<string> {
  try {
    const { rows } = await client.query<{ id: string }>("SELECT system_identifier::text AS id FROM pg_control_system()");
    return `${rows[0].id}/${(await client.query<{ db: string }>("SELECT current_database() AS db")).rows[0].db}`;
  } catch {
    // Not allowed for this role: fall back to the server's address and database.
    const { rows } = await client.query<{ id: string }>("SELECT coalesce(inet_server_addr()::text, 'local') || ':' || current_setting('port') || '/' || current_database() AS id");
    return rows[0].id;
  }
}

/** True when the desktop store holds no work yet: at most the empty project made on first launch. */
async function destinationEmpty(db: DB): Promise<boolean> {
  const { rows } = await sql<{ busy: boolean }>`
    SELECT EXISTS (SELECT 1 FROM trees) OR EXISTS (SELECT 1 FROM nodes) OR EXISTS (SELECT 1 FROM feedback_items)
      OR EXISTS (SELECT 1 FROM definitions) OR (SELECT count(*) FROM projects) > 1 AS busy`.execute(db);
  return !rows[0].busy;
}

type Checked = { client: pg.Client; systemId: string; counts: Record<string, number>; tables: Table[] };

async function preconditions(client: pg.Client, db: DB): Promise<Checked> {
  const known = Object.keys(MIGRATIONS).sort();
  const { rows: mig } = await client.query<{ name: string }>(
    "SELECT name FROM kysely_migration ORDER BY name",
  ).catch(() => ({ rows: [] as Array<{ name: string }> }));
  const source = mig.map((r) => r.name);
  const ahead = source.filter((n) => !known.includes(n));
  if (ahead.length) throw new ImportRefused("schema_ahead", `The web app's database has ${ahead.join(", ")}, which this version of Farabi doesn't know. Update Farabi first.`);
  const behind = known.filter((n) => !source.includes(n));
  if (behind.length) throw new ImportRefused("schema_behind", `The web app's database is missing ${behind.join(", ")}. Run its migrations (npm run db:migrate) first.`);

  const systemId = await systemIdentifier(client);
  const prior = await db.selectFrom("import_runs").select("id").where("source_system_identifier", "=", systemId).where("outcome", "=", "succeeded").executeTakeFirst();
  if (prior) throw new ImportRefused("already_imported", "This database was already imported. Farabi imports it only once.");
  if (!(await destinationEmpty(db))) {
    throw new ImportRefused("destination_not_empty", "This Farabi already has projects or feedback. Import only works into a new, empty Farabi.");
  }
  const list = await tables(db);
  const counts: Record<string, number> = {};
  for (const t of list) {
    const { rows } = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${qualified(t)}`);
    counts[t.full] = Number(rows[0].n);
  }
  return { client, systemId, counts, tables: list };
}

export async function checkImport(opts: ImportOptions): Promise<ImportCheckResponse> {
  let client: pg.Client | null = null;
  try {
    client = await connectSource(opts.connectionString);
    const { counts } = await preconditions(client, opts.dest ?? appDb);
    return { ready: true, counts };
  } catch (err) {
    if (err instanceof ImportRefused) return { ready: false, reason: err.reason, detail: err.message };
    throw err;
  } finally {
    await client?.end().catch(() => undefined);
  }
}

/** Copies the attachment files the imported rows refer to, checking each size. */
async function copyAttachments(client: pg.Client, from: string, to: string, written: string[]): Promise<number> {
  const { rows } = await client.query<{ file_path: string; thumb_path: string | null; byte_size: number }>(
    "SELECT file_path, thumb_path, byte_size FROM feedback_attachments ORDER BY id",
  );
  const inside = (root: string, rel: string) => {
    const abs = path.resolve(/*turbopackIgnore: true*/ root, rel);
    if (!abs.startsWith(path.resolve(/*turbopackIgnore: true*/ root) + path.sep)) throw new Error(`Attachment path outside the feedback folder: ${rel}`);
    return abs;
  };
  let copied = 0;
  for (const r of rows) {
    for (const rel of [r.file_path, r.thumb_path]) {
      if (!rel) continue;
      const src = inside(from, rel);
      const dest = inside(to, rel);
      await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(dest), { recursive: true });
      await fs.copyFile(/*turbopackIgnore: true*/ src, dest);
      written.push(dest);
      const size = (await fs.stat(/*turbopackIgnore: true*/ dest)).size;
      if (rel === r.file_path && size !== r.byte_size) throw new Error(`${rel} is ${size} bytes, expected ${r.byte_size}`);
      copied++;
    }
  }
  return copied;
}

/** Runs the import. Refusals throw ImportRefused (nothing written); failures throw ImportFailed after rollback. */
export async function runImport(opts: ImportOptions): Promise<ImportResult> {
  const db = opts.dest ?? appDb;
  const client = await connectSource(opts.connectionString);
  const startedAt = new Date();
  const label = sourceLabel(opts.connectionString);
  const schemaLevel = Object.keys(MIGRATIONS).sort().at(-1) ?? "";
  let checked: Checked;
  try {
    checked = await preconditions(client, db);
  } catch (err) {
    await client.end().catch(() => undefined);
    throw err;
  }
  const written: string[] = [];
  let attachmentsCopied = 0;
  try {
    // A consistent view of the source for the whole copy.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await db.transaction().execute(async (trx) => {
      await sql`SET LOCAL session_replication_role = replica`.execute(trx);
      await sql`SET LOCAL TIME ZONE 'UTC'`.execute(trx);
      // Clear what first launch made (the empty default project, its camera); keep the settings history.
      const clear = checked.tables.filter((t) => !KEEP_DESTINATION.has(t.full)).map(qualified);
      if (clear.length) await sql.raw(`TRUNCATE ${clear.join(", ")}`).execute(trx);

      let n = 0;
      for (const t of checked.tables) {
        const cols = t.columns.map(ident).join(", ");
        for (let offset = 0; ; offset += BATCH) {
          const { rows } = await client.query<{ batch: string }>(
            `SELECT coalesce(json_agg(row_to_json(t))::text, '[]') AS batch FROM (SELECT * FROM ${qualified(t)} t ORDER BY ${orderBy(t)} LIMIT ${BATCH} OFFSET ${offset}) t`,
          );
          const batch = rows[0].batch;
          if (batch === "[]") break;
          await sql
            .raw(`INSERT INTO ${qualified(t)} (${cols}) OVERRIDING SYSTEM VALUE SELECT ${cols} FROM json_populate_recordset(NULL::${qualified(t)}, ${sqlLiteral(batch)}::json)`)
            .execute(trx);
          if (JSON.parse(batch).length < BATCH) break;
        }
        // Identity and serial columns continue after the copied ids.
        await resetSequences(trx, t);
        if (opts.failAfterTables !== undefined && ++n >= opts.failAfterTables) throw new Error(`Injected failure after ${n} tables`);
      }

      for (const t of checked.tables) {
        const src = await digest(async (text) => (await client.query<{ n: string; md5: string }>(text)).rows[0], t);
        const dst = await digest(async (text) => (await sql.raw<{ n: string; md5: string }>(text).execute(trx)).rows[0], t);
        if (KEEP_DESTINATION.has(t.full)) {
          // The kept table holds the source rows plus the desktop app's own: check the source rows are there.
          const missing = await countMissing(client, trx, t);
          if (missing) throw new Error(`${missing} rows of ${t.full} didn't arrive`);
          continue;
        }
        if (src.n !== dst.n || src.md5 !== dst.md5) throw new Error(`${t.full} differs after the copy (${src.n} rows in, ${dst.n} copied)`);
      }

      if (opts.attachmentsDir) attachmentsCopied = await copyAttachments(client, opts.attachmentsDir, opts.attachmentsTo ?? feedbackDir(), written);
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end().catch(() => undefined);
    await Promise.all(written.map((f) => fs.rm(f, { force: true })));
    const message = err instanceof Error ? err.message : String(err);
    const run = await recordRun(db, { systemId: checked.systemId, label, schemaLevel, startedAt, outcome: "failed", counts: checked.counts, checksumsMatch: null, error: message });
    throw new ImportFailed(run, message);
  }
  await client.end().catch(() => undefined);
  const runId = await recordRun(db, { systemId: checked.systemId, label, schemaLevel, startedAt, outcome: "succeeded", counts: checked.counts, checksumsMatch: true, error: null });
  return { runId, outcome: "succeeded", counts: checked.counts, checksumsMatch: true, attachmentsCopied };
}

/** A SQL string literal. Only used for the JSON batches built above. */
function sqlLiteral(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

async function resetSequences(trx: Trx, t: Table): Promise<void> {
  for (const col of t.columns) {
    const { rows } = await sql<{ seq: string | null }>`SELECT pg_get_serial_sequence(${`${ident(t.schema)}.${ident(t.name)}`}, ${col}) AS seq`.execute(trx);
    const seq = rows[0]?.seq;
    if (!seq) continue;
    await sql.raw(`SELECT setval('${seq.replace(/'/g, "''")}', coalesce((SELECT max(${ident(col)}) FROM ${qualified(t)}), 0) + 1, false)`).execute(trx);
  }
}

/** Source rows of a kept table that aren't in the destination, compared by primary key. */
async function countMissing(client: pg.Client, trx: Trx, t: Table): Promise<number> {
  const key = t.pk[0] ?? t.columns[0];
  const { rows } = await client.query<{ ids: string }>(`SELECT coalesce(json_agg(${ident(key)})::text, '[]') AS ids FROM ${qualified(t)}`);
  const ids = JSON.parse(rows[0].ids) as string[];
  if (!ids.length) return 0;
  const { rows: found } = await sql.raw<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${qualified(t)} WHERE ${ident(key)}::text IN (SELECT jsonb_array_elements_text(${sqlLiteral(JSON.stringify(ids))}::jsonb))`,
  ).execute(trx);
  return ids.length - Number(found[0].n);
}

async function recordRun(db: DB, r: {
  systemId: string;
  label: string;
  schemaLevel: string;
  startedAt: Date;
  outcome: "succeeded" | "failed";
  counts: Record<string, number>;
  checksumsMatch: boolean | null;
  error: string | null;
}): Promise<string> {
  const row = await db
    .insertInto("import_runs")
    .values({
      source_system_identifier: r.systemId,
      source_label: r.label,
      schema_level: r.schemaLevel,
      started_at: r.startedAt,
      finished_at: new Date(),
      outcome: r.outcome,
      counts: JSON.stringify(r.counts),
      checksums_match: r.checksumsMatch,
      error: r.error,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}
