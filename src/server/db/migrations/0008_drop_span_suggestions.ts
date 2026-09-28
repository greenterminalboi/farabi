import { type Kysely, sql } from "kysely";

// Feature 5 rework: suggested underlines now come from the reply's own bold text, found while
// rendering, so the AI-computed span cache is no longer used. It only ever held hidden,
// ai_suggested hints that nothing referenced; dropping it loses nothing the user created.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE span_suggestions`.execute(db);
}

export async function down(): Promise<void> {
  throw new Error("Migrations are forward-only");
}
