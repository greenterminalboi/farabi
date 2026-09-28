import type { FireParkedResponse } from "@/shared/schemas";
import { db } from "../db/client";
import { insertBranch, validateAnchor } from "../forest/branch";
import { assertId } from "../ids";
import { toMapNode, toMarker, toMessage } from "../mappers";
import { generate, insertUserTurn } from "../messages/send";
import { placeholderFor } from "../summaries/placeholder";
import { asConsumed, currentQuestion, lockTangent } from "./state";

/**
 * Turns a live parked tangent into a real branch (FR-012–FR-014, research R2). The branch, its
 * marker, the first message and pending reply (when there's a question) and the `fired` event are
 * written in one transaction, so the item is either still parked or fully consumed. With a
 * question the reply starts after commit, like any send; without one the anchor text comes back
 * as the composer draft.
 */
export async function fireParked(id: string): Promise<FireParkedResponse> {
  assertId(id, "Parked item");

  const created = await db
    .transaction()
    .execute(async (trx) => {
      const t = await lockTangent(trx, id);
      const question = await currentQuestion(trx, id);
      const anchor = { messageId: t.message_id, start: t.start_offset, end: t.end_offset, text: t.anchor_text };
      const { parent, message } = await validateAnchor(trx, t.node_id, anchor);
      const { child, marker } = await insertBranch(trx, parent, message, anchor);
      const turn = question === null ? null : await insertUserTurn(trx, child.id, question);
      await trx.insertInto("parked_tangent_events").values({ tangent_id: id, kind: "fired", child_node_id: child.id }).execute();
      return { t, child, marker, turn };
    })
    .catch(asConsumed);

  const { t, child, marker, turn } = created;
  const node = toMapNode(child, t.anchor_text, placeholderFor(t.anchor_text));
  if (!turn) return { kind: "preload", node, marker: toMarker(marker), draft: t.anchor_text };

  void generate(child.id, turn.pending.id);
  return {
    kind: "sent",
    node,
    marker: toMarker(marker),
    userMessage: toMessage(turn.userMessage),
    aiMessage: toMessage(turn.pending),
  };
}
