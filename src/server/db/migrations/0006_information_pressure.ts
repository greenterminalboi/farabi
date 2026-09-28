import { type Kysely, sql } from "kysely";

// Feature 6: information pressure and reply model. Settings are an append-only history of
// user-authored changes; the newest row per key is in effect (FR-013, FR-020, Article VI). Each AI
// reply records the level and model it started with (FR-009, FR-019), set once at insert.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE setting_changes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      key text NOT NULL CHECK (key IN ('information_pressure', 'reply_model')),
      value jsonb NOT NULL,
      provenance provenance NOT NULL DEFAULT 'user_authored' CHECK (provenance = 'user_authored'),
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (key <> 'information_pressure' OR (jsonb_typeof(value) = 'number' AND (value)::int BETWEEN 1 AND 10)),
      CHECK (key <> 'reply_model' OR jsonb_typeof(value) = 'string')
    )`.execute(db);
  await sql`CREATE INDEX setting_changes_latest ON setting_changes (key, created_at DESC, id DESC)`.execute(db);
  await sql`
    CREATE FUNCTION setting_changes_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'setting_changes is append-only: % is not allowed', TG_OP;
    END $$`.execute(db);
  await sql`
    CREATE TRIGGER setting_changes_append_only
    BEFORE UPDATE OR DELETE ON setting_changes
    FOR EACH ROW EXECUTE FUNCTION setting_changes_append_only()`.execute(db);

  await sql`
    ALTER TABLE messages
      ADD COLUMN pressure_level smallint CHECK (pressure_level BETWEEN 1 AND 10),
      ADD COLUMN reply_model text`.execute(db);
}

export async function down(): Promise<void> {
  throw new Error("Migrations are forward-only");
}
