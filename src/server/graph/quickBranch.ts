// "????" (FR-020, Feature 2): re-ask the question that produced the focused answer, as a sibling
// edge from that question's own source. The re-asked edge is a sibling, never an ancestor, so the
// new reply's context excludes it.
import type { AskResponse } from "@/shared/schemas";
import { db } from "../db/client";
import { generate, insertAsk } from "./ask";
import { toElement } from "./elements";

export const QUICK_BRANCH = "????";

/**
 * Returns null unless the answer's edge is a question with a source that hasn't been re-asked yet;
 * the caller then sends "????" as an ordinary message.
 */
export async function tryQuickBranch(answerId: string): Promise<Extract<AskResponse, { kind: "quick_branch" }> | null> {
  const created = await db.transaction().execute(async (trx) => {
    const answer = await trx
      .selectFrom("nodes")
      .innerJoin("projects", "projects.id", "nodes.project_id")
      .select(["nodes.kind", "nodes.parent_id"])
      .where("nodes.id", "=", answerId)
      .where("projects.trashed_at", "is", null)
      .executeTakeFirst();
    if (answer?.kind !== "answer" || !answer.parent_id) return null;
    // Lock the re-asked edge: one re-ask per edge (requery_of is unique).
    const edge = await trx.selectFrom("nodes").selectAll().where("id", "=", answer.parent_id).forUpdate().executeTakeFirst();
    if (edge?.kind !== "question" || edge.parent_id === null || edge.text === null) return null;
    const used = await trx.selectFrom("nodes").select("id").where("requery_of", "=", edge.id).executeTakeFirst();
    if (used) return null;
    const source = await trx.selectFrom("nodes").selectAll().where("id", "=", edge.parent_id).executeTakeFirstOrThrow();
    return insertAsk(trx, source, edge.text, { origin: "quick_branch", requeryOf: edge.id });
  });
  if (!created) return null;
  void generate(created.answer.id);
  return {
    kind: "quick_branch",
    edge: toElement(created.edge, { newestAttempt: created.answer }),
    answer: toElement(created.answer),
  };
}
