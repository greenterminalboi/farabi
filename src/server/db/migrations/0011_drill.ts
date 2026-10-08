import { type Kysely, sql } from "kysely";

// Feature 12: Drill Kaizen (specs/012-drill-kaizen/data-model.md). Drill text lives in `nodes` as
// hidden kinds (research R1); everything that changes over time is an append-only `drill_*` row.
// Where "the newest row" decides something, an identity `seq` orders rows, never created_at
// (STATUS 16:15 convention: timestamps can tie).

/** Every drill table; each gets the append-only trigger (Article II). */
export const DRILL_TABLES = [
  "drills",
  "drill_ladder_versions",
  "drill_level_changes",
  "drill_round_ends",
  "drill_problem_events",
  "drill_verdict_overrides",
  "drill_attachments",
  "drill_offers",
  "drill_offer_events",
];

export async function up(db: Kysely<unknown>): Promise<void> {
  // A drill node, and a drill_start edge under an existing element, have origin 'drill' (R2).
  await sql`ALTER TABLE nodes DROP CONSTRAINT nodes_origin_check`.execute(db);
  await sql`
    ALTER TABLE nodes ADD CONSTRAINT nodes_origin_check
    CHECK (origin IN ('origin', 'ask', 'branch', 'quick_branch', 'parked', 'reply', 'retry', 'regenerate', 'run', 'drill'))`.execute(db);

  await sql`
    CREATE TABLE drills (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      node_id uuid NOT NULL UNIQUE REFERENCES nodes(id) ON DELETE RESTRICT,
      domain text NOT NULL CHECK (length(domain) BETWEEN 1 AND 300),
      domain_provenance provenance NOT NULL,
      source_node_id uuid REFERENCES nodes(id) ON DELETE RESTRICT,
      parent_drill_id uuid REFERENCES drills(id) ON DELETE RESTRICT,
      started_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`.execute(db);
  await sql`CREATE INDEX drills_project ON drills (project_id, created_at)`.execute(db);

  await sql`
    CREATE TABLE drill_ladder_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
      drill_id uuid NOT NULL REFERENCES drills(id) ON DELETE RESTRICT,
      rungs jsonb NOT NULL CHECK (jsonb_typeof(rungs) = 'array'),
      provenance provenance NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`.execute(db);
  await sql`CREATE INDEX drill_ladder_latest ON drill_ladder_versions (drill_id, seq DESC)`.execute(db);

  await sql`
    CREATE TABLE drill_level_changes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
      drill_id uuid NOT NULL REFERENCES drills(id) ON DELETE RESTRICT,
      rung_id uuid NOT NULL,
      round_id uuid REFERENCES nodes(id) ON DELETE RESTRICT,
      from_level smallint CHECK (from_level BETWEEN 1 AND 10),
      to_level smallint NOT NULL CHECK (to_level BETWEEN 1 AND 10),
      from_state text CHECK (from_state IN ('locked', 'open', 'solid')),
      to_state text NOT NULL CHECK (to_state IN ('locked', 'open', 'solid')),
      cause text NOT NULL CHECK (cause IN ('start', 'auto', 'recompute', 'manual')),
      provenance provenance NOT NULL,
      evidence uuid[] NOT NULL DEFAULT '{}',
      supersedes uuid REFERENCES drill_level_changes(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK ((cause = 'start') = (from_level IS NULL)),
      CHECK ((from_level IS NULL) = (from_state IS NULL)),
      CHECK ((cause = 'manual') = (provenance = 'user_authored')),
      CHECK (cause <> 'manual' OR evidence = '{}'),
      -- A recompute supersedes the round's change for that rung, or adds one where it held (FR-021).
      CHECK (supersedes IS NULL OR cause = 'recompute'),
      CHECK (cause NOT IN ('auto', 'recompute') OR round_id IS NOT NULL)
    )`.execute(db);
  await sql`CREATE INDEX drill_levels_latest ON drill_level_changes (drill_id, rung_id, seq DESC)`.execute(db);

  await sql`
    CREATE TABLE drill_round_ends (
      round_id uuid PRIMARY KEY REFERENCES nodes(id) ON DELETE RESTRICT,
      ended_by text NOT NULL CHECK (ended_by IN ('all_answered', 'user')),
      -- The newest drill_level_changes.seq when the round ended, before its own changes: the
      -- levels a recompute starts from (FR-021).
      levels_seq bigint NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`.execute(db);

  await sql`
    CREATE TABLE drill_problem_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      problem_id uuid NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
      type text NOT NULL CHECK (type IN ('hint', 'reveal', 'flag', 'skip', 'replaced')),
      detail jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(detail) = 'object'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`.execute(db);
  await sql`CREATE INDEX drill_problem_events_by_problem ON drill_problem_events (problem_id, created_at)`.execute(db);

  await sql`
    CREATE TABLE drill_verdict_overrides (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
      verdict_id uuid NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
      verdict text NOT NULL CHECK (verdict IN ('solved', 'partly_solved', 'not_solved')),
      provenance provenance NOT NULL DEFAULT 'user_authored' CHECK (provenance = 'user_authored'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`.execute(db);
  await sql`CREATE INDEX drill_overrides_by_verdict ON drill_verdict_overrides (verdict_id, seq)`.execute(db);

  await sql`
    CREATE TABLE drill_attachments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
      drill_id uuid NOT NULL REFERENCES drills(id) ON DELETE RESTRICT,
      node_id uuid NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
      action text NOT NULL CHECK (action IN ('attach', 'detach')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`.execute(db);
  await sql`CREATE INDEX drill_attachments_latest ON drill_attachments (drill_id, node_id, seq DESC)`.execute(db);

  await sql`
    CREATE TABLE drill_offers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      drill_id uuid NOT NULL UNIQUE REFERENCES drills(id) ON DELETE RESTRICT,
      round_id uuid NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
      candidates jsonb NOT NULL CHECK (jsonb_typeof(candidates) = 'array' AND jsonb_array_length(candidates) BETWEEN 1 AND 3),
      function_id text NOT NULL,
      function_version integer NOT NULL,
      provenance provenance NOT NULL DEFAULT 'ai_suggested' CHECK (provenance = 'ai_suggested'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`.execute(db);

  await sql`
    CREATE TABLE drill_offer_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      offer_id uuid NOT NULL REFERENCES drill_offers(id) ON DELETE RESTRICT,
      type text NOT NULL CHECK (type IN ('picked', 'dismissed')),
      node_id uuid REFERENCES nodes(id) ON DELETE RESTRICT,
      new_drill_id uuid REFERENCES drills(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK ((type = 'picked') = (node_id IS NOT NULL AND new_drill_id IS NOT NULL))
    )`.execute(db);

  // A drill's node, attachments and source are in the drill's own project.
  await sql`
    CREATE FUNCTION drills_same_project() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM nodes WHERE id = NEW.node_id AND project_id = NEW.project_id AND kind = 'drill') THEN
        RAISE EXCEPTION 'drills: node_id must be a drill node in the same project';
      END IF;
      IF NEW.source_node_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM nodes WHERE id = NEW.source_node_id AND project_id = NEW.project_id) THEN
        RAISE EXCEPTION 'drills: the source must be in the same project';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER drills_same_project BEFORE INSERT ON drills FOR EACH ROW EXECUTE FUNCTION drills_same_project()`.execute(db);

  await sql`
    CREATE FUNCTION drill_attachments_same_project() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM nodes n JOIN drills d ON d.project_id = n.project_id
        WHERE n.id = NEW.node_id AND d.id = NEW.drill_id) THEN
        RAISE EXCEPTION 'drill_attachments: the node must be in the drill''s project';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`
    CREATE TRIGGER drill_attachments_same_project BEFORE INSERT ON drill_attachments
    FOR EACH ROW EXECUTE FUNCTION drill_attachments_same_project()`.execute(db);

  // Append-only (Article II). The one allowed update: drills.started_at, set once from NULL.
  await sql`
    CREATE FUNCTION drill_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      -- Nested, because PL/pgSQL doesn't short-circuit AND and other tables have no started_at.
      IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'drills' THEN
        IF OLD.started_at IS NULL AND NEW.started_at IS NOT NULL
           AND (NEW.id, NEW.project_id, NEW.node_id, NEW.domain, NEW.domain_provenance, NEW.source_node_id,
                NEW.parent_drill_id, NEW.created_at)
               IS NOT DISTINCT FROM
               (OLD.id, OLD.project_id, OLD.node_id, OLD.domain, OLD.domain_provenance, OLD.source_node_id,
                OLD.parent_drill_id, OLD.created_at) THEN
          RETURN NEW;
        END IF;
      END IF;
      RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
    END $$`.execute(db);
  for (const table of DRILL_TABLES) {
    await sql`
      CREATE TRIGGER ${sql.raw(`${table}_append_only`)}
      BEFORE UPDATE OR DELETE ON ${sql.table(table)}
      FOR EACH ROW EXECUTE FUNCTION drill_append_only()`.execute(db);
  }
}

export async function down(): Promise<void> {
  throw new Error("Migrations are forward-only");
}
