// A small v1 project seeded straight into the frozen schema and converted, for the end-to-end
// migration test (T073). Only reachable through a test-only route.
import { type Kysely, sql } from "kysely";
import { backfillAfterConversion, convertV1 } from "./convert";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- writes the v1 schema, outside the app's Database type
type Q = Kysely<any>;

export async function seedAndConvertV1(db: Q, projectId: string): Promise<{ conversationId: string; branchId: string }> {
  const ids = { tree: crypto.randomUUID(), root: crypto.randomUUID(), branch: crypto.randomUUID() };
  const m = { u1: crypto.randomUUID(), a1: crypto.randomUUID(), u2: crypto.randomUUID(), a2: crypto.randomUUID() };
  const answer = "Pods are **groups** of containers that share a network.";
  const t = (s: number) => new Date(Date.UTC(2026, 8, 1, 9, 0, s));
  await db.transaction().execute(async (trx) => {
    await sql`SET CONSTRAINTS ALL DEFERRED`.execute(trx);
    await sql`INSERT INTO v1.trees (id, project_id, root_node_id, layout_origin_x, layout_origin_y, created_at)
      VALUES (${ids.tree}, ${projectId}, ${ids.root}, 0, 0, ${t(0)})`.execute(trx);
    await sql`INSERT INTO v1.nodes (id, tree_id, parent_id, provenance, kind, origin, created_at) VALUES
      (${ids.root}, ${ids.tree}, NULL, 'user_authored', 'conversation', 'root', ${t(1)}),
      (${ids.branch}, ${ids.tree}, ${ids.root}, 'user_authored', 'conversation', 'branch', ${t(5)})`.execute(trx);
    await sql`INSERT INTO v1.messages (id, node_id, seq, role, content, status, provenance, created_at) VALUES
      (${m.u1}, ${ids.root}, 1, 'user', 'What are pods?', 'complete', 'user_authored', ${t(2)}),
      (${m.a1}, ${ids.root}, 2, 'ai', ${answer}, 'complete', 'ai_suggested', ${t(3)}),
      (${m.u2}, ${ids.branch}, 1, 'user', 'Why groups?', 'complete', 'user_authored', ${t(6)}),
      (${m.a2}, ${ids.branch}, 2, 'ai', 'Because they schedule together.', 'complete', 'ai_suggested', ${t(7)})`.execute(trx);
    const start = answer.indexOf("groups");
    await sql`INSERT INTO v1.branch_markers (parent_node_id, message_id, child_node_id, start_offset, end_offset, anchor_text, prefix, suffix, provenance, created_at)
      VALUES (${ids.root}, ${m.a1}, ${ids.branch}, ${start}, ${start + 6}, 'groups', ${answer.slice(0, start)}, ${answer.slice(start + 6, start + 38)}, 'user_authored', ${t(4)})`.execute(trx);
    await sql`INSERT INTO definitions (project_id, term, term_key, source_node_id, source_message_id) VALUES
      (${projectId}, 'Pods', 'pods', ${ids.root}, ${m.a1})`.execute(trx);
    await convertV1(trx);
    await backfillAfterConversion(trx);
  });
  return { conversationId: ids.root, branchId: ids.branch };
}
