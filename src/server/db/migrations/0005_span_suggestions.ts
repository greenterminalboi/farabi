import { type Kysely, sql } from "kysely";

// Feature 5: a hidden cache of suggested branch spans per completed AI message (FR-013). It is not
// part of the user's structure: nothing references it, rows are only inserted, and every row is
// ai_suggested (Article I). Deleting it loses nothing the user created.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE span_suggestions (
      message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      detector_version integer NOT NULL,
      spans jsonb NOT NULL,
      provenance provenance NOT NULL DEFAULT 'ai_suggested' CHECK (provenance = 'ai_suggested'),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (message_id, detector_version)
    )`.execute(db);
}

export async function down(): Promise<void> {
  throw new Error("Migrations are forward-only");
}
