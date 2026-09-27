import { type Kysely, sql } from "kysely";

// Feature 3: in-app feedback. Tags, attachments and state events default to clock_timestamp()
// and are inserted one row at a time, so their order is the order they were given in. Additive only; history and attachments can never be edited or
// deleted, and an item can only have its manual rank changed (research R8, Article II).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TYPE feedback_view AS ENUM ('chat', 'map', 'definitions')`.execute(db);
  await sql`CREATE TYPE feedback_state AS ENUM ('open', 'addressed', 'resolved')`.execute(db);

  await sql`
    CREATE TABLE feedback_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      text text NOT NULL CHECK (length(btrim(text)) > 0 AND length(text) <= 20000),
      view feedback_view NOT NULL,
      node_id uuid REFERENCES nodes(id) ON DELETE RESTRICT,
      rank text COLLATE "C",
      provenance provenance NOT NULL CHECK (provenance = 'user_authored'),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT feedback_items_node_only_in_chat CHECK (node_id IS NULL OR view = 'chat')
    )`.execute(db);
  await sql`CREATE INDEX feedback_items_created ON feedback_items (created_at DESC)`.execute(db);

  await sql`
    CREATE TABLE feedback_tags (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id uuid NOT NULL REFERENCES feedback_items(id) ON DELETE RESTRICT,
      text text NOT NULL CHECK (length(text) BETWEEN 1 AND 60),
      tag_key text NOT NULL,
      provenance provenance NOT NULL CHECK (provenance = 'user_authored'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (item_id, tag_key)
    )`.execute(db);
  await sql`CREATE INDEX feedback_tags_key ON feedback_tags (tag_key)`.execute(db);

  await sql`
    CREATE TABLE feedback_attachments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id uuid NOT NULL REFERENCES feedback_items(id) ON DELETE RESTRICT,
      file_path text NOT NULL UNIQUE,
      thumb_path text,
      original_name text,
      mime_type text NOT NULL
        CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
      byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
      sha256 text NOT NULL,
      provenance provenance NOT NULL CHECK (provenance = 'user_authored'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`.execute(db);
  await sql`CREATE INDEX feedback_attachments_item ON feedback_attachments (item_id)`.execute(db);

  await sql`
    CREATE TABLE feedback_state_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id uuid NOT NULL REFERENCES feedback_items(id) ON DELETE RESTRICT,
      state feedback_state NOT NULL,
      provenance provenance NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT feedback_state_who CHECK (
        (state = 'open' AND provenance = 'user_authored') OR
        (state = 'addressed' AND provenance = 'ai_suggested') OR
        (state = 'resolved' AND provenance = 'user_confirmed')
      )
    )`.execute(db);
  await sql`CREATE INDEX feedback_state_events_latest ON feedback_state_events (item_id, created_at DESC)`.execute(db);

  await sql`
    CREATE FUNCTION feedback_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
    END $$`.execute(db);
  for (const table of ["feedback_state_events", "feedback_tags", "feedback_attachments"]) {
    await sql`
      CREATE TRIGGER ${sql.raw(`${table}_append_only`)}
      BEFORE UPDATE OR DELETE ON ${sql.table(table)}
      FOR EACH ROW EXECUTE FUNCTION feedback_append_only()`.execute(db);
  }

  await sql`
    CREATE FUNCTION feedback_items_rank_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'feedback_items cannot be deleted';
      END IF;
      IF (NEW.id, NEW.text, NEW.view, NEW.node_id, NEW.provenance, NEW.created_at)
         IS DISTINCT FROM (OLD.id, OLD.text, OLD.view, OLD.node_id, OLD.provenance, OLD.created_at) THEN
        RAISE EXCEPTION 'only feedback_items.rank can change';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`
    CREATE TRIGGER feedback_items_rank_only
    BEFORE UPDATE OR DELETE ON feedback_items
    FOR EACH ROW EXECUTE FUNCTION feedback_items_rank_only()`.execute(db);
}

export async function down(): Promise<void> {
  throw new Error("Migrations are forward-only");
}
