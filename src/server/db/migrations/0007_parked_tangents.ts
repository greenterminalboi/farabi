import { type Kysely, sql } from "kysely";

// Feature 8: parked tangents. A tangent is a user-authored anchor that isn't a branch yet. Its row
// never changes; editing the question, discarding and firing are appended as events, so nothing is
// deleted and abandoned tangents stay on record (research R1, Articles II and VI). At most one
// terminal event per tangent means at most one branch per tangent (FR-014).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE parked_tangents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      node_id uuid NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
      message_id uuid NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
      start_offset integer NOT NULL,
      end_offset integer NOT NULL,
      anchor_text text NOT NULL CHECK (btrim(anchor_text) <> ''),
      prefix text NOT NULL,
      suffix text NOT NULL,
      provenance provenance NOT NULL DEFAULT 'user_authored' CHECK (provenance = 'user_authored'),
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (start_offset >= 0 AND start_offset < end_offset)
    )`.execute(db);
  await sql`CREATE INDEX parked_tangents_by_node ON parked_tangents (node_id, created_at DESC, id DESC)`.execute(db);
  await sql`CREATE INDEX parked_tangents_by_message ON parked_tangents (message_id)`.execute(db);

  await sql`
    CREATE TABLE parked_tangent_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tangent_id uuid NOT NULL REFERENCES parked_tangents(id) ON DELETE RESTRICT,
      kind text NOT NULL CHECK (kind IN ('question_set', 'discarded', 'fired')),
      question text,
      child_node_id uuid REFERENCES nodes(id) ON DELETE RESTRICT,
      provenance provenance NOT NULL DEFAULT 'user_authored' CHECK (provenance = 'user_authored'),
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (question IS NULL OR kind = 'question_set'),
      CHECK (question IS NULL OR btrim(question) <> ''),
      CHECK ((kind = 'fired') = (child_node_id IS NOT NULL))
    )`.execute(db);
  await sql`
    CREATE INDEX parked_events_latest ON parked_tangent_events (tangent_id, created_at DESC, id DESC)`.execute(db);
  await sql`
    CREATE UNIQUE INDEX parked_events_terminal ON parked_tangent_events (tangent_id)
    WHERE kind IN ('discarded', 'fired')`.execute(db);

  await sql`
    CREATE FUNCTION parked_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
    END $$`.execute(db);
  for (const table of ["parked_tangents", "parked_tangent_events"]) {
    await sql`
      CREATE TRIGGER ${sql.raw(`${table}_append_only`)}
      BEFORE UPDATE OR DELETE ON ${sql.table(table)}
      FOR EACH ROW EXECUTE FUNCTION parked_append_only()`.execute(db);
  }
}

export async function down(): Promise<void> {
  throw new Error("Migrations are forward-only");
}
