import { type Kysely, sql } from "kysely";

// Feature 9: node kinds and node functions. Every node gets a kind and an origin; existing nodes
// become conversations with their origin read from their history (research R1). Function outputs
// and pipes are nodes too, never children. Output text, review actions and kind settings are
// append-only, and so are summaries, whose row id is the version outputs are checked against
// (research R4, R5, R7; Articles I, II and VI).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE nodes
      ADD COLUMN kind text NOT NULL DEFAULT 'conversation',
      ADD COLUMN origin text,
      ADD COLUMN function_id text,
      ADD COLUMN function_version integer,
      ADD COLUMN properties jsonb NOT NULL DEFAULT '{}'`.execute(db);

  await sql`UPDATE nodes SET origin = 'root' WHERE id IN (SELECT root_node_id FROM trees)`.execute(db);
  await sql`
    UPDATE nodes SET origin = 'parked'
    WHERE origin IS NULL AND id IN (SELECT child_node_id FROM parked_tangent_events WHERE kind = 'fired')`.execute(db);
  await sql`
    UPDATE nodes SET origin = 'quick_branch'
    WHERE origin IS NULL AND id IN (SELECT child_node_id FROM branch_markers WHERE kind = 'whole_message')`.execute(db);
  await sql`UPDATE nodes SET origin = 'branch' WHERE origin IS NULL`.execute(db);

  await sql`
    ALTER TABLE nodes
      ALTER COLUMN kind DROP DEFAULT,
      ALTER COLUMN origin SET NOT NULL,
      ADD CONSTRAINT nodes_origin_check CHECK (origin IN ('root', 'branch', 'quick_branch', 'parked', 'function')),
      ADD CONSTRAINT nodes_function_check
        CHECK ((origin = 'function') = (function_id IS NOT NULL AND function_version IS NOT NULL)),
      ADD CONSTRAINT nodes_properties_check CHECK (jsonb_typeof(properties) = 'object'),
      ADD CONSTRAINT nodes_only_conversations_have_parents CHECK (kind = 'conversation' OR parent_id IS NULL)`.execute(db);
  await sql`CREATE INDEX nodes_kind_tree ON nodes (tree_id, kind)`.execute(db);

  await sql`
    CREATE TABLE pipes (
      node_id uuid PRIMARY KEY REFERENCES nodes(id) ON DELETE RESTRICT,
      input_node_id uuid NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
      output_node_id uuid NOT NULL UNIQUE REFERENCES nodes(id) ON DELETE RESTRICT,
      reads text NOT NULL CHECK (reads IN ('summary', 'conversation', 'anchor')),
      function_id text NOT NULL,
      function_version integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (input_node_id <> output_node_id)
    )`.execute(db);
  await sql`CREATE INDEX pipes_by_input ON pipes (input_node_id)`.execute(db);

  await sql`
    CREATE TABLE function_output_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      output_node_id uuid NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
      text text NOT NULL CHECK (btrim(text) <> ''),
      source_version uuid NOT NULL,
      function_version integer NOT NULL,
      settings jsonb NOT NULL,
      provenance provenance NOT NULL DEFAULT 'ai_suggested' CHECK (provenance = 'ai_suggested'),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (id, output_node_id)
    )`.execute(db);
  await sql`
    CREATE INDEX output_versions_latest ON function_output_versions (output_node_id, created_at DESC, id DESC)`.execute(db);

  await sql`
    CREATE TABLE function_output_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      output_node_id uuid NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
      kind text NOT NULL CHECK (kind IN ('confirmed', 'rejected')),
      version_id uuid,
      provenance provenance NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK ((kind = 'confirmed') = (version_id IS NOT NULL)),
      CHECK ((kind = 'confirmed' AND provenance = 'user_confirmed') OR (kind = 'rejected' AND provenance = 'user_authored')),
      FOREIGN KEY (version_id, output_node_id) REFERENCES function_output_versions (id, output_node_id)
    )`.execute(db);
  await sql`
    CREATE INDEX output_events_latest ON function_output_events (output_node_id, created_at DESC, id DESC)`.execute(db);

  await sql`
    CREATE TABLE kind_setting_changes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind text NOT NULL,
      key text NOT NULL,
      node_id uuid REFERENCES nodes(id) ON DELETE RESTRICT,
      value jsonb,
      provenance provenance NOT NULL DEFAULT 'user_authored' CHECK (provenance = 'user_authored'),
      created_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`
    CREATE INDEX kind_settings_latest ON kind_setting_changes (kind, key, node_id, created_at DESC, id DESC)`.execute(db);

  await sql`
    CREATE FUNCTION node_functions_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
    END $$`.execute(db);
  for (const table of ["pipes", "function_output_versions", "function_output_events", "kind_setting_changes", "node_summaries"]) {
    await sql`
      CREATE TRIGGER ${sql.raw(`${table}_append_only`)}
      BEFORE UPDATE OR DELETE ON ${sql.table(table)}
      FOR EACH ROW EXECUTE FUNCTION node_functions_append_only()`.execute(db);
  }
}

export async function down(): Promise<void> {
  throw new Error("Migrations are forward-only");
}
