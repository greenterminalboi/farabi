import type { ParkRequest, ParkedTangent } from "@/shared/schemas";
import { db } from "../db/client";
import { validateSpan } from "../graph/branch";
import { assertId } from "../ids";
import { asConsumed, currentQuestion, lockTangent, normalizeQuestion, toParkedTangent } from "./state";

/**
 * Parks a tangent on a span of any element's final text (Feature 8, FR-021). The span is
 * validated exactly as for Branch, but no edge is created and no element changes.
 */
export async function parkTangent(nodeId: string, body: ParkRequest): Promise<{ parked: ParkedTangent }> {
  assertId(nodeId, "Element");
  const question = normalizeQuestion(body.question);

  return db.transaction().execute(async (trx) => {
    const { span } = await validateSpan(trx, nodeId, body);
    const row = await trx
      .insertInto("parked_tangents")
      .values({
        node_id: nodeId,
        start_offset: span.start,
        end_offset: span.end,
        anchor_text: span.text,
        prefix: span.prefix,
        suffix: span.suffix,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    if (question !== null) {
      await trx.insertInto("parked_tangent_events").values({ tangent_id: row.id, kind: "question_set", question }).execute();
    }
    return { parked: toParkedTangent(row, question) };
  });
}

/** Sets, changes or clears a live item's question; an unchanged value writes nothing. */
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

/** Discards a live item. It is recorded, not deleted, and never becomes a branch. */
export async function discardParked(id: string): Promise<{ parked: ParkedTangent }> {
  assertId(id, "Parked item");
  return db
    .transaction()
    .execute(async (trx) => {
      const row = await lockTangent(trx, id);
      const question = await currentQuestion(trx, id);
      await trx.insertInto("parked_tangent_events").values({ tangent_id: id, kind: "discarded" }).execute();
      return { parked: toParkedTangent(row, question) };
    })
    .catch(asConsumed);
}
