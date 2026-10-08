import { type Kysely, sql } from "kysely";

// Feature 13: Farabi Lexicon (specs/013-lexicon/research.md R3). Lexicon terms are recorded in a
// question edge's declared properties. Branch and parked edges are created unsent, and their
// message (with its terms) is written later by the send transition, so send may now set
// `properties` once, from the empty object. Everything else in nodes_guard() is 0010's, unchanged.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE OR REPLACE FUNCTION nodes_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      same_text boolean := NEW.text IS NOT DISTINCT FROM OLD.text;
      same_sent boolean := NEW.sent_at IS NOT DISTINCT FROM OLD.sent_at;
      same_status boolean := NEW.status IS NOT DISTINCT FROM OLD.status;
      same_partial boolean := NEW.partial_text IS NOT DISTINCT FROM OLD.partial_text;
      same_place boolean := (NEW.manual_x, NEW.manual_y) IS NOT DISTINCT FROM (OLD.manual_x, OLD.manual_y);
      same_props boolean := NEW.properties IS NOT DISTINCT FROM OLD.properties;
      is_send boolean := OLD.kind = 'question' AND OLD.text IS NULL AND OLD.sent_at IS NULL
         AND NEW.text IS NOT NULL AND NEW.sent_at IS NOT NULL;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'nodes cannot be deleted';
      END IF;
      IF (NEW.id, NEW.project_id, NEW.tree_id, NEW.parent_id, NEW.kind, NEW.shape, NEW.origin, NEW.provenance,
          NEW.anchor_start, NEW.anchor_end, NEW.anchor_text, NEW.anchor_prefix, NEW.anchor_suffix,
          NEW.requery_of, NEW.function_id, NEW.function_version,
          NEW.pressure_level, NEW.reply_model, NEW.created_at)
         IS DISTINCT FROM
         (OLD.id, OLD.project_id, OLD.tree_id, OLD.parent_id, OLD.kind, OLD.shape, OLD.origin, OLD.provenance,
          OLD.anchor_start, OLD.anchor_end, OLD.anchor_text, OLD.anchor_prefix, OLD.anchor_suffix,
          OLD.requery_of, OLD.function_id, OLD.function_version,
          OLD.pressure_level, OLD.reply_model, OLD.created_at) THEN
        RAISE EXCEPTION 'nodes: structure, kind and provenance never change';
      END IF;
      -- Declared properties never change, except that a send may set them once (Feature 13).
      IF NOT same_props AND NOT (is_send AND OLD.properties = '{}'::jsonb) THEN
        RAISE EXCEPTION 'nodes: structure, kind and provenance never change';
      END IF;
      IF same_text AND same_sent AND same_status AND same_partial AND same_place THEN
        RETURN NEW;
      END IF;
      -- 1. Send: an unsent question edge gets its text and send time, once.
      IF is_send AND same_status AND same_partial AND same_place THEN
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
}

export async function down(): Promise<void> {
  throw new Error("Migrations are forward-only");
}
