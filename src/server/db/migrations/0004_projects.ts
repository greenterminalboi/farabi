import { type Kysely, sql } from "kysely";

// Feature 4: projects. Each tree and definition belongs to one project. Existing data moves into
// "My first project". Trashing only hides a project (trashed_at); nothing is deleted (Article II).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE projects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
      created_at timestamptz NOT NULL DEFAULT now(),
      trashed_at timestamptz
    )`.execute(db);

  await sql`ALTER TABLE trees ADD COLUMN project_id uuid REFERENCES projects(id) ON DELETE RESTRICT`.execute(db);
  await sql`ALTER TABLE definitions ADD COLUMN project_id uuid REFERENCES projects(id) ON DELETE RESTRICT`.execute(db);

  await sql`
    WITH first AS (
      INSERT INTO projects (name)
      SELECT 'My first project' WHERE EXISTS (SELECT 1 FROM trees)
      RETURNING id
    )
    UPDATE trees SET project_id = (SELECT id FROM first)`.execute(db);
  await sql`
    UPDATE definitions d SET project_id = t.project_id
    FROM nodes n JOIN trees t ON t.id = n.tree_id
    WHERE n.id = d.source_node_id`.execute(db);

  await sql`ALTER TABLE trees ALTER COLUMN project_id SET NOT NULL`.execute(db);
  await sql`ALTER TABLE definitions ALTER COLUMN project_id SET NOT NULL`.execute(db);
  await sql`CREATE INDEX trees_project ON trees (project_id)`.execute(db);
  // A term is unique within its project, no longer across all of them.
  await sql`ALTER TABLE definitions DROP CONSTRAINT definitions_term_key_key`.execute(db);
  await sql`ALTER TABLE definitions ADD CONSTRAINT definitions_project_term UNIQUE (project_id, term_key)`.execute(db);
}

export async function down(): Promise<void> {
  throw new Error("Migrations are forward-only");
}
