import { type Kysely, sql } from "kysely";

// Feature 11 (desktop app). Settings that used to live in environment variables become user
// settings in the existing append-only history (data-model.md §3), and the one-time import from
// the web app's database gets an append-only audit record (data-model.md §4, FR-017).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE setting_changes
      DROP CONSTRAINT setting_changes_key_check,
      ADD CONSTRAINT setting_changes_key_check CHECK (key IN (
        'information_pressure', 'reply_model', 'ai_provider', 'default_model', 'summary_trigger',
        'feedback_export_dir', 'claude_code_path')),
      ADD CONSTRAINT setting_changes_ai_provider_check
        CHECK (key <> 'ai_provider' OR (value #>> '{}') IN ('claude', 'claude-code', 'fake')),
      ADD CONSTRAINT setting_changes_default_model_check
        CHECK (key <> 'default_model' OR jsonb_typeof(value) IN ('string', 'null')),
      ADD CONSTRAINT setting_changes_summary_trigger_check
        CHECK (key <> 'summary_trigger' OR (value #>> '{}') IN ('reply', 'map')),
      ADD CONSTRAINT setting_changes_path_check
        CHECK (key NOT IN ('feedback_export_dir', 'claude_code_path') OR jsonb_typeof(value) IN ('string', 'null'))`.execute(db);

  await sql`
    CREATE TABLE import_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source_system_identifier text NOT NULL,
      source_label text NOT NULL,
      schema_level text NOT NULL,
      started_at timestamptz NOT NULL,
      finished_at timestamptz,
      outcome text NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
      counts jsonb NOT NULL,
      checksums_match boolean,
      error text,
      provenance provenance NOT NULL DEFAULT 'user_authored' CHECK (provenance = 'user_authored')
    )`.execute(db);
  await sql`
    CREATE FUNCTION import_runs_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'import_runs is append-only: % is not allowed', TG_OP;
    END $$`.execute(db);
  await sql`
    CREATE TRIGGER import_runs_append_only
    BEFORE UPDATE OR DELETE ON import_runs
    FOR EACH ROW EXECUTE FUNCTION import_runs_append_only()`.execute(db);
}

export async function down(): Promise<void> {
  throw new Error("Migrations are forward-only");
}
