import type { FireParkedResponse } from "@/shared/schemas";
import { insertPendingAnswer } from "../answers/generation";
import { db } from "../db/client";
import { generate } from "../graph/ask";
import { insertBranchEdge, validateSpan } from "../graph/branch";
import { toElement } from "../graph/elements";
import { assertId } from "../ids";
import { asConsumed, currentQuestion, lockTangent } from "./state";

/**
 * Turns a live parked tangent into a branch edge (FR-021). The edge, its pending answer (when
 * there is a question) and the `fired` event are written in one transaction, so the item is either
 * still parked or fully consumed. With a question the reply starts after commit, like any send;
 * without one the edge stays unsent and the anchor text comes back as the composer draft.
 */
export async function fireParked(id: string): Promise<FireParkedResponse> {
  assertId(id, "Parked item");

  const created = await db
    .transaction()
    .execute(async (trx) => {
      const t = await lockTangent(trx, id);
      const question = await currentQuestion(trx, id);
      const { element, span } = await validateSpan(trx, t.node_id, {
        start: t.start_offset,
        end: t.end_offset,
        text: t.anchor_text,
      });
      const edge = await insertBranchEdge(trx, element, span, "parked", question);
      const answer = question === null ? null : await insertPendingAnswer(trx, edge, "reply");
      await trx.insertInto("parked_tangent_events").values({ tangent_id: id, kind: "fired", edge_id: edge.id }).execute();
      return { t, edge, answer };
    })
    .catch(asConsumed);

  const { t, edge, answer } = created;
  if (!answer) return { kind: "preload", edge: toElement(edge), draft: t.anchor_text };
  void generate(answer.id);
  return { kind: "sent", edge: toElement(edge, { newestAttempt: answer }), answer: toElement(answer) };
}
