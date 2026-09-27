import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS vector`.execute(db);

  await sql`CREATE TYPE provenance AS ENUM ('ai_suggested', 'user_confirmed', 'user_authored')`.execute(db);
  await sql`CREATE TYPE message_role AS ENUM ('user', 'ai')`.execute(db);
  await sql`CREATE TYPE message_status AS ENUM ('pending', 'complete', 'failed')`.execute(db);

  await sql`
    CREATE TABLE trees (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      root_node_id uuid NOT NULL,
      layout_origin_x real NOT NULL DEFAULT 0,
      layout_origin_y real NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);

  await sql`
    CREATE TABLE nodes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tree_id uuid NOT NULL REFERENCES trees(id) ON DELETE RESTRICT,
      parent_id uuid REFERENCES nodes(id) ON DELETE RESTRICT,
      provenance provenance NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);

  await sql`
    ALTER TABLE trees
      ADD CONSTRAINT trees_root_node_id_key UNIQUE (root_node_id) DEFERRABLE INITIALLY DEFERRED,
      ADD CONSTRAINT trees_root_node_id_fkey FOREIGN KEY (root_node_id)
        REFERENCES nodes(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
  `.execute(db);

  await sql`
    CREATE TABLE messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      node_id uuid NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
      seq integer NOT NULL,
      role message_role NOT NULL,
      content text NOT NULL,
      status message_status NOT NULL,
      provenance provenance NOT NULL,
      replaced_at timestamptz,
      replaced_by uuid REFERENCES messages(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);

  await sql`
    CREATE TABLE branch_markers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_node_id uuid NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
      message_id uuid NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
      child_node_id uuid NOT NULL UNIQUE REFERENCES nodes(id) ON DELETE RESTRICT,
      start_offset integer NOT NULL,
      end_offset integer NOT NULL,
      anchor_text text NOT NULL,
      prefix text NOT NULL,
      suffix text NOT NULL,
      provenance provenance NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT branch_markers_offsets_check CHECK (start_offset >= 0 AND end_offset > start_offset)
    )`.execute(db);

  await sql`
    CREATE TABLE node_summaries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      node_id uuid NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
      text text NOT NULL,
      provenance provenance NOT NULL,
      through_message_id uuid NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);

  await sql`CREATE UNIQUE INDEX messages_node_seq_live ON messages (node_id, seq) WHERE replaced_at IS NULL`.execute(db);
  await sql`CREATE INDEX messages_node_seq ON messages (node_id, seq)`.execute(db);
  await sql`CREATE INDEX nodes_tree_id ON nodes (tree_id)`.execute(db);
  await sql`CREATE INDEX nodes_parent_id ON nodes (parent_id)`.execute(db);
  await sql`CREATE INDEX branch_markers_parent ON branch_markers (parent_node_id)`.execute(db);
  await sql`CREATE INDEX branch_markers_message ON branch_markers (message_id)`.execute(db);
  await sql`CREATE INDEX node_summaries_latest ON node_summaries (node_id, created_at DESC)`.execute(db);
}

export async function down(): Promise<void> {
  throw new Error("Migrations are forward-only");
}
