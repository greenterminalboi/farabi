import type { ParkRequest, ParkedTangent } from "@/shared/schemas";
import { db } from "../db/client";
import { assertId } from "../ids";
import { toParkedTangent } from "../mappers";
import { validateAnchor } from "../forest/branch";
import { lockNode } from "../messages/send";
import { asConsumed, currentQuestion, lockTangent, normalizeQuestion } from "./state";

/**
 * Parks a tangent on a selection (FR-006, FR-007, FR-011). The anchor is validated exactly as for
 * Branch, but no node, marker or message is created.
 */
export async function parkTangent(nodeId: string, body: ParkRequest): Promise<{ parked: ParkedTangent }> {
  assertId(nodeId, "Node");
  assertId(body.messageId, "Message");
  const question = normalizeQuestion(body.question);

  return db.transaction().execute(async (trx) => {
    // Serializes with regenerate, which could otherwise replace the message mid-park (R6).
    await lockNode(trx, nodeId);
    await validateAnchor(trx, nodeId, body);
    const row = await trx
      .insertInto("parked_tangents")
      .values({
        node_id: nodeId,
        message_id: body.messageId,
        start_offset: body.start,
        end_offset: body.end,
        anchor_text: body.text,
        prefix: body.prefix,
        suffix: body.suffix,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    if (question !== null) {
      await trx.insertInto("parked_tangent_events").values({ tangent_id: row.id, kind: "question_set", question }).execute();
    }
    return { parked: toParkedTangent(row, question) };
  });
}

/** Sets, changes or clears a live item's question (FR-015); an unchanged value writes nothing. */
export async function setParkedQuestion(id: string, question: string | null): Promise<{ parked: ParkedTangent }> {
  assertId(id, "Parked item");
  const next = normalizeQuestion(question);
  return db.transaction().execute(async (trx) => {
    const row = await lockTangent(trx, id);
    if (next !== (await currentQuestion(trx, id))) {
      await trx.insertInto("parked_tangent_events").values({ tangent_id: id, kind: "question_set", question: next }).execute();
    }
    return { parked: toParkedTangent(row, next) };
  });
}

/** Discards a live item (FR-015). It is recorded, not deleted, and never becomes a branch. */
export async function discardParked(id: string): Promise<{ discarded: { id: string } }> {
  assertId(id, "Parked item");
  await db
    .transaction()
    .execute(async (trx) => {
      await lockTangent(trx, id);
      await trx.insertInto("parked_tangent_events").values({ tangent_id: id, kind: "discarded" }).execute();
    })
    .catch(asConsumed);
  return { discarded: { id } };
}
