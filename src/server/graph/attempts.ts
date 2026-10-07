// Retry and regenerate (FR-041, FR-042): a new answer under the same edge, as a sibling attempt.
// Earlier attempts and everything branched from them stay as they are (Article II).
import type { AnswerResponse } from "@/shared/schemas";
import { insertPendingAnswer } from "../answers/generation";
import { db } from "../db/client";
import { ConflictError } from "../errors";
import { assertId } from "../ids";
import { generate } from "./ask";
import { loadLive, lockElement, newestAttempt, toElement } from "./elements";

export async function newAttempt(edgeId: string, mode: "retry" | "regenerate"): Promise<AnswerResponse> {
  assertId(edgeId, "Edge");
  const answer = await db.transaction().execute(async (trx) => {
    await loadLive(trx, edgeId);
    const edge = await lockElement(trx, edgeId);
    if (edge.kind !== "question") throw new ConflictError("not_an_edge", "Only a message has replies to retry");
    const newest = await newestAttempt(trx, edgeId);
    if (newest?.status === "pending") throw new ConflictError("reply_in_progress", "Wait for the current reply to finish");
    if (mode === "retry") {
      // A sent edge with no attempt at all counts as failed (research R5).
      const retryable = edge.text !== null && (!newest || ["incomplete", "stopped", "failed"].includes(newest.status ?? ""));
      if (!retryable) throw new ConflictError("not_retryable", "Only an unfinished reply can be retried");
    } else {
      const complete = await trx
        .selectFrom("nodes")
        .select("id")
        .where("parent_id", "=", edgeId)
        .where("kind", "=", "answer")
        .where("status", "=", "complete")
        .executeTakeFirst();
      if (!complete) throw new ConflictError("not_regenerable", "There is no finished reply to regenerate");
    }
    return insertPendingAnswer(trx, edge, mode);
  });
  void generate(answer.id);
  return { answer: toElement(answer) };
}
