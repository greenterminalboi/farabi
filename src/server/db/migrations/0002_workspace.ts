import { type Kysely, sql } from "kysely";

// Feature 2: streaming reply states, quick-branch markers, hand-placed positions, edge labels,
// definitions. Additive only (Constitution Article II).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TYPE message_status ADD VALUE IF NOT EXISTS 'incomplete'`.execute(db);
  await sql`ALTER TYPE message_status ADD VALUE IF NOT EXISTS 'stopped'`.execute(db);
  await sql`CREATE TYPE marker_kind AS ENUM ('selection', 'whole_message')`.execute(db);

  await sql`ALTER TABLE trees ADD COLUMN user_placed boolean NOT NULL DEFAULT false`.execute(db);
  await sql`
    ALTER TABLE nodes
      ADD COLUMN manual_x real,
      ADD COLUMN manual_y real,
      ADD CONSTRAINT nodes_manual_pair CHECK ((manual_x IS NULL) = (manual_y IS NULL))
  `.execute(db);
  await sql`ALTER TABLE messages ADD COLUMN partial_content text`.execute(db);
  await sql`ALTER TABLE branch_markers ADD COLUMN kind marker_kind NOT NULL DEFAULT 'selection'`.execute(db);
  await sql`CREATE UNIQUE INDEX branch_markers_one_quick_branch ON branch_markers (message_id) WHERE kind = 'whole_message'`.execute(db);

  await sql`
    CREATE TABLE edge_label_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      child_node_id uuid NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
      text text CHECK (text IS NULL OR (length(text) BETWEEN 1 AND 200)),
      provenance provenance NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`CREATE INDEX edge_label_versions_latest ON edge_label_versions (child_node_id, created_at DESC)`.execute(db);

  await sql`
    CREATE TABLE definitions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      term text NOT NULL CHECK (length(term) BETWEEN 1 AND 120),
      term_key text NOT NULL UNIQUE,
      source_node_id uuid NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
      source_message_id uuid NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
      draft_failed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`
    CREATE TABLE definition_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      definition_id uuid NOT NULL REFERENCES definitions(id) ON DELETE RESTRICT,
      general_text text NOT NULL,
      usage_text text NOT NULL,
      provenance provenance NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`CREATE INDEX definition_versions_latest ON definition_versions (definition_id, created_at DESC)`.execute(db);
}

export async function down(): Promise<void> {
  throw new Error("Migrations are forward-only");
}
