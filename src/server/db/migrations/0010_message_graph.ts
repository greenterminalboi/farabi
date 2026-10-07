import { type Kysely, sql } from "kysely";
import { backfillAfterConversion, convertV1, printReport, recordChecksums } from "../v1/convert";

// Feature 10: the message graph (data-model.md, contracts/migration.md). The v1 tables move,
// untouched, into a frozen `v1` schema (research R2); every graph element is a row of the new
// `nodes` table with one parent (R1); the converter rebuilds v1 data as v2 rows (R4). Everything
// runs in the migrator's single transaction, so an interrupted run leaves the database as it was.

/** The twelve v1 tables and the column their rows are ordered by for the checksum. */
export const V1_TABLES: Array<[table: string, pk: string]> = [
  ["trees", "id"],
  ["nodes", "id"],
  ["messages", "id"],
  ["branch_markers", "id"],
  ["node_summaries", "id"],
  ["edge_label_versions", "id"],
  ["parked_tangents", "id"],
  ["parked_tangent_events", "id"],
  ["pipes", "node_id"],
  ["function_output_versions", "id"],
  ["function_output_events", "id"],
  ["kind_setting_changes", "id"],
];

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Freeze the originals. Moving a table keeps its rows, ids, constraints and indexes.
  await sql`CREATE SCHEMA v1`.execute(db);
  for (const [table] of V1_TABLES) {
    await sql`ALTER TABLE ${sql.table(table)} SET SCHEMA v1`.execute(db);
  }
  await sql`
    CREATE FUNCTION v1.frozen() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION '% is frozen v1 data: % is not allowed', TG_TABLE_NAME, TG_OP;
    END $$`.execute(db);
  for (const [table] of V1_TABLES) {
    await sql`
      CREATE TRIGGER v1_frozen BEFORE UPDATE OR DELETE ON ${sql.table(`v1.${table}`)}
      FOR EACH ROW EXECUTE FUNCTION v1.frozen()`.execute(db);
  }

  // 2. Checksums of the frozen tables, compared later by v1:verify (SC-003).
  await sql`
    CREATE TABLE v1_checksums (
      table_name text PRIMARY KEY,
      row_count bigint NOT NULL,
      digest text NOT NULL,
      taken_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await recordChecksums(db, V1_TABLES);

  // 3. New tables.
  await sql`
    CREATE TABLE trees (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      layout_origin_x real NOT NULL,
      layout_origin_y real NOT NULL,
      user_placed boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`.execute(db);
  await sql`CREATE INDEX trees_project ON trees (project_id)`.execute(db);

  await sql`
    CREATE TABLE nodes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      tree_id uuid NOT NULL REFERENCES trees(id) ON DELETE RESTRICT,
      parent_id uuid,
      kind text NOT NULL,
      shape text NOT NULL CHECK (shape IN ('node', 'edge')),
      origin text NOT NULL
        CHECK (origin IN ('origin', 'ask', 'branch', 'quick_branch', 'parked', 'reply', 'retry', 'regenerate', 'run')),
      provenance provenance NOT NULL,
      text text,
      status text CHECK (status IN ('pending', 'complete', 'incomplete', 'stopped', 'failed')),
      partial_text text,
      pressure_level smallint CHECK (pressure_level BETWEEN 1 AND 10),
      reply_model text,
      anchor_start integer,
      anchor_end integer,
      anchor_text text,
      anchor_prefix text,
      anchor_suffix text,
      requery_of uuid UNIQUE REFERENCES nodes(id) ON DELETE RESTRICT,
      function_id text,
      function_version integer,
      properties jsonb NOT NULL DEFAULT '{}',
      manual_x real,
      manual_y real,
      sent_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT nodes_id_tree UNIQUE (id, tree_id),
      CONSTRAINT nodes_parent_same_tree FOREIGN KEY (parent_id, tree_id) REFERENCES nodes (id, tree_id) ON DELETE RESTRICT,
      CONSTRAINT nodes_only_origin_has_no_parent CHECK (parent_id IS NOT NULL OR (shape = 'edge' AND origin = 'origin')),
      CONSTRAINT nodes_content_has_text CHECK (shape = 'edge' OR text IS NOT NULL),
      CONSTRAINT nodes_anchor_complete CHECK (
        (anchor_start IS NULL) = (anchor_end IS NULL) AND (anchor_start IS NULL) = (anchor_text IS NULL)),
      CONSTRAINT nodes_anchor_offsets CHECK (anchor_start IS NULL OR (anchor_start >= 0 AND anchor_start < anchor_end)),
      CONSTRAINT nodes_anchor_origin CHECK (anchor_start IS NULL OR origin IN ('branch', 'parked')),
      CONSTRAINT nodes_requery_origin CHECK (requery_of IS NULL OR origin = 'quick_branch'),
      CONSTRAINT nodes_manual_pair CHECK ((manual_x IS NULL) = (manual_y IS NULL)),
      CONSTRAINT nodes_function_run CHECK ((origin = 'run') = (function_id IS NOT NULL AND function_version IS NOT NULL)),
      CONSTRAINT nodes_properties_object CHECK (jsonb_typeof(properties) = 'object')
    )`.execute(db);
  await sql`CREATE UNIQUE INDEX nodes_one_origin_per_tree ON nodes (tree_id) WHERE parent_id IS NULL`.execute(db);
  await sql`CREATE INDEX nodes_tree ON nodes (tree_id)`.execute(db);
  await sql`CREATE INDEX nodes_children ON nodes (parent_id, created_at, id)`.execute(db);
  await sql`CREATE INDEX nodes_project ON nodes (project_id)`.execute(db);
  await sql`CREATE INDEX nodes_pending ON nodes (parent_id) WHERE status = 'pending'`.execute(db);

  await sql`
    CREATE TABLE edge_notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      edge_id uuid NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
      text text CHECK (text IS NULL OR length(text) BETWEEN 1 AND 200),
      provenance provenance NOT NULL DEFAULT 'user_authored' CHECK (provenance = 'user_authored'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`.execute(db);
  await sql`CREATE INDEX edge_notes_latest ON edge_notes (edge_id, created_at DESC, id DESC)`.execute(db);

  await sql`
    CREATE TABLE output_reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      node_id uuid NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
      kind text NOT NULL CHECK (kind IN ('confirmed', 'rejected')),
      provenance provenance NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK ((kind = 'confirmed' AND provenance = 'user_confirmed') OR (kind = 'rejected' AND provenance = 'user_authored'))
    )`.execute(db);
  await sql`CREATE INDEX output_reviews_latest ON output_reviews (node_id, created_at DESC, id DESC)`.execute(db);

  await sql`
    CREATE TABLE kind_setting_changes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind text NOT NULL,
      key text NOT NULL,
      node_id uuid REFERENCES nodes(id) ON DELETE RESTRICT,
      value jsonb,
      provenance provenance NOT NULL DEFAULT 'user_authored' CHECK (provenance = 'user_authored'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`.execute(db);
  await sql`
    CREATE INDEX kind_settings_latest ON kind_setting_changes (kind, key, node_id, created_at DESC, id DESC)`.execute(db);

  await sql`
    CREATE TABLE parked_tangents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      node_id uuid NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
      start_offset integer NOT NULL,
      end_offset integer NOT NULL,
      anchor_text text NOT NULL CHECK (btrim(anchor_text) <> ''),
      prefix text NOT NULL,
      suffix text NOT NULL,
      provenance provenance NOT NULL DEFAULT 'user_authored' CHECK (provenance = 'user_authored'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK (start_offset >= 0 AND start_offset < end_offset)
    )`.execute(db);
  await sql`CREATE INDEX parked_tangents_by_node ON parked_tangents (node_id, created_at DESC, id DESC)`.execute(db);

  await sql`
    CREATE TABLE parked_tangent_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tangent_id uuid NOT NULL REFERENCES parked_tangents(id) ON DELETE RESTRICT,
      kind text NOT NULL CHECK (kind IN ('question_set', 'discarded', 'fired')),
      question text,
      edge_id uuid REFERENCES nodes(id) ON DELETE RESTRICT,
      provenance provenance NOT NULL DEFAULT 'user_authored' CHECK (provenance = 'user_authored'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK (question IS NULL OR kind = 'question_set'),
      CHECK (question IS NULL OR btrim(question) <> ''),
      CHECK ((kind = 'fired') = (edge_id IS NOT NULL))
    )`.execute(db);
  await sql`
    CREATE INDEX parked_events_latest ON parked_tangent_events (tangent_id, created_at DESC, id DESC)`.execute(db);
  await sql`
    CREATE UNIQUE INDEX parked_events_terminal ON parked_tangent_events (tangent_id)
    WHERE kind IN ('discarded', 'fired')`.execute(db);

  await sql`
    CREATE TABLE project_cameras (
      project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE RESTRICT,
      x real NOT NULL,
      y real NOT NULL,
      scale real NOT NULL CHECK (scale BETWEEN 0.02 AND 4),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`.execute(db);

  await sql`
    CREATE TABLE v1_conversion (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      v1_table text NOT NULL,
      v1_id uuid NOT NULL,
      v2_id uuid,
      detail jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT v1_conversion_once UNIQUE NULLS NOT DISTINCT (v1_table, v1_id, v2_id)
    )`.execute(db);
  await sql`CREATE INDEX v1_conversion_v2 ON v1_conversion (v2_id)`.execute(db);

  // 4. Triggers on the new tables.
  await sql`
    CREATE FUNCTION nodes_shape_rule() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      parent_shape text;
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM trees WHERE id = NEW.tree_id AND project_id = NEW.project_id) THEN
        RAISE EXCEPTION 'nodes: an element belongs to its tree''s project';
      END IF;
      IF NEW.shape = 'node' THEN
        SELECT shape INTO parent_shape FROM nodes WHERE id = NEW.parent_id;
        IF parent_shape IS DISTINCT FROM 'edge' THEN
          RAISE EXCEPTION 'nodes: a content node''s parent must be an edge';
        END IF;
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`
    CREATE TRIGGER nodes_shape_rule BEFORE INSERT ON nodes
    FOR EACH ROW EXECUTE FUNCTION nodes_shape_rule()`.execute(db);

  // Sent text, answers, structure and provenance never change, and nothing is deleted (FR-008,
  // Article II). The four allowed updates are send, checkpoint, finalize and placement.
  await sql`
    CREATE FUNCTION nodes_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      same_text boolean := NEW.text IS NOT DISTINCT FROM OLD.text;
      same_sent boolean := NEW.sent_at IS NOT DISTINCT FROM OLD.sent_at;
      same_status boolean := NEW.status IS NOT DISTINCT FROM OLD.status;
      same_partial boolean := NEW.partial_text IS NOT DISTINCT FROM OLD.partial_text;
      same_place boolean := (NEW.manual_x, NEW.manual_y) IS NOT DISTINCT FROM (OLD.manual_x, OLD.manual_y);
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'nodes cannot be deleted';
      END IF;
      IF (NEW.id, NEW.project_id, NEW.tree_id, NEW.parent_id, NEW.kind, NEW.shape, NEW.origin, NEW.provenance,
          NEW.anchor_start, NEW.anchor_end, NEW.anchor_text, NEW.anchor_prefix, NEW.anchor_suffix,
          NEW.requery_of, NEW.function_id, NEW.function_version, NEW.properties,
          NEW.pressure_level, NEW.reply_model, NEW.created_at)
         IS DISTINCT FROM
         (OLD.id, OLD.project_id, OLD.tree_id, OLD.parent_id, OLD.kind, OLD.shape, OLD.origin, OLD.provenance,
          OLD.anchor_start, OLD.anchor_end, OLD.anchor_text, OLD.anchor_prefix, OLD.anchor_suffix,
          OLD.requery_of, OLD.function_id, OLD.function_version, OLD.properties,
          OLD.pressure_level, OLD.reply_model, OLD.created_at) THEN
        RAISE EXCEPTION 'nodes: structure, kind and provenance never change';
      END IF;
      IF same_text AND same_sent AND same_status AND same_partial AND same_place THEN
        RETURN NEW;
      END IF;
      -- 1. Send: an unsent question edge gets its text and send time, once.
      IF OLD.kind = 'question' AND OLD.text IS NULL AND OLD.sent_at IS NULL
         AND NEW.text IS NOT NULL AND NEW.sent_at IS NOT NULL
         AND same_status AND same_partial AND same_place THEN
        RETURN NEW;
      END IF;
      -- 2. Checkpoint: a pending answer's partial text.
      IF OLD.status = 'pending' AND NEW.status = 'pending' AND NOT same_partial
         AND same_text AND same_sent AND same_place THEN
        RETURN NEW;
      END IF;
      -- 3. Finalize: a pending answer ends, written once; the checkpoint is cleared.
      IF OLD.status = 'pending' AND NEW.status IN ('complete', 'incomplete', 'stopped', 'failed')
         AND NEW.partial_text IS NULL AND NEW.text IS NOT NULL AND same_sent AND same_place THEN
        RETURN NEW;
      END IF;
      -- 4. Placement: only the hand position.
      IF NOT same_place AND same_text AND same_sent AND same_status AND same_partial THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'nodes: this change is not allowed';
    END $$`.execute(db);
  await sql`
    CREATE TRIGGER nodes_guard BEFORE UPDATE OR DELETE ON nodes
    FOR EACH ROW EXECUTE FUNCTION nodes_guard()`.execute(db);

  await sql`
    CREATE FUNCTION edge_notes_edge_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM nodes WHERE id = NEW.edge_id AND shape = 'edge') THEN
        RAISE EXCEPTION 'edge_notes: notes belong to edges';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`
    CREATE TRIGGER edge_notes_edge_only BEFORE INSERT ON edge_notes
    FOR EACH ROW EXECUTE FUNCTION edge_notes_edge_only()`.execute(db);

  await sql`
    CREATE FUNCTION output_reviews_output_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM nodes WHERE id = NEW.node_id AND origin = 'run' AND shape = 'node') THEN
        RAISE EXCEPTION 'output_reviews: only function outputs are reviewed';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`
    CREATE TRIGGER output_reviews_output_only BEFORE INSERT ON output_reviews
    FOR EACH ROW EXECUTE FUNCTION output_reviews_output_only()`.execute(db);

  await sql`
    CREATE FUNCTION graph_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
    END $$`.execute(db);
  for (const table of [
    "edge_notes",
    "output_reviews",
    "kind_setting_changes",
    "parked_tangents",
    "parked_tangent_events",
    "v1_conversion",
  ]) {
    await sql`
      CREATE TRIGGER ${sql.raw(`${table}_append_only`)}
      BEFORE UPDATE OR DELETE ON ${sql.table(table)}
      FOR EACH ROW EXECUTE FUNCTION graph_append_only()`.execute(db);
  }

  // 5. Definitions: a source element replaces the conversation and message pair (FR-055).
  await sql`
    ALTER TABLE definitions
      ADD COLUMN source_id uuid REFERENCES nodes(id) ON DELETE RESTRICT,
      ALTER COLUMN source_node_id DROP NOT NULL,
      ALTER COLUMN source_message_id DROP NOT NULL,
      ADD CONSTRAINT definitions_has_source CHECK (source_id IS NOT NULL OR source_node_id IS NOT NULL)`.execute(db);

  // 6. Feedback: the canvas view, its project and element (FR-058). The new enum value can't be
  // used in this transaction, so the check compares text.
  await sql`ALTER TYPE feedback_view ADD VALUE 'canvas'`.execute(db);
  await sql`
    ALTER TABLE feedback_items
      ADD COLUMN project_id uuid REFERENCES projects(id) ON DELETE RESTRICT,
      ADD COLUMN element_id uuid REFERENCES nodes(id) ON DELETE RESTRICT,
      DROP CONSTRAINT feedback_items_node_only_in_chat,
      ADD CONSTRAINT feedback_items_node_only_in_chat CHECK (node_id IS NULL OR view = 'chat'),
      ADD CONSTRAINT feedback_items_element_view CHECK (element_id IS NULL OR view::text IN ('chat', 'canvas'))`.execute(db);

  // 7. Conversion.
  const report = await convertV1(db);

  // 8. Backfills, then freeze the new feedback columns too.
  await backfillAfterConversion(db);
  await sql`
    CREATE OR REPLACE FUNCTION feedback_items_rank_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'feedback_items cannot be deleted';
      END IF;
      IF (NEW.id, NEW.text, NEW.view, NEW.node_id, NEW.project_id, NEW.element_id, NEW.provenance, NEW.created_at)
         IS DISTINCT FROM
         (OLD.id, OLD.text, OLD.view, OLD.node_id, OLD.project_id, OLD.element_id, OLD.provenance, OLD.created_at) THEN
        RAISE EXCEPTION 'only feedback_items.rank can change';
      END IF;
      RETURN NEW;
    END $$`.execute(db);

  printReport(report);
}

export async function down(): Promise<void> {
  throw new Error("Migrations are forward-only");
}
