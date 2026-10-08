import { type Kysely, sql } from "kysely";

// Feature 13 follow-up (owner decision 2026-10-07): the composer picks up lexicon terms from the
// user's text unless the user turns it off. The switch is one more app setting in the existing
// append-only history, so the key check (0012) gains `lexicon_autodetect`, whose value is a boolean.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE setting_changes
      DROP CONSTRAINT setting_changes_key_check,
      ADD CONSTRAINT setting_changes_key_check CHECK (key IN (
        'information_pressure', 'reply_model', 'ai_provider', 'default_model', 'summary_trigger',
        'feedback_export_dir', 'claude_code_path', 'lexicon_autodetect')),
      ADD CONSTRAINT setting_changes_lexicon_autodetect_check
        CHECK (key <> 'lexicon_autodetect' OR jsonb_typeof(value) = 'boolean')`.execute(db);
}

export async function down(): Promise<void> {
  throw new Error("Migrations are forward-only");
}
