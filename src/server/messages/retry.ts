import type { Message } from "@/shared/schemas";
import { db } from "../db/client";
import { ConflictError, NotFoundError } from "../errors";
import { assertId } from "../ids";
import { toMessage } from "../mappers";
import { completeReply, lockNode } from "./send";

/** Retries a failed AI reply. The failed row is kept, marked as replaced (Article VI). */
export async function retryReply(messageId: string): Promise<{ aiMessage: Message }> {
  assertId(messageId, "Message");
  const { nodeId, pendingId } = await db.transaction().execute(async (trx) => {
    const failed = await trx.selectFrom("messages").selectAll().where("id", "=", messageId).executeTakeFirst();
    if (!failed) throw new NotFoundError("Message not found");
    await lockNode(trx, failed.node_id);

    const latest = await trx
      .selectFrom("messages")
      .select("id")
      .where("node_id", "=", failed.node_id)
      .where("replaced_at", "is", null)
      .orderBy("seq", "desc")
      .limit(1)
      .executeTakeFirst();
    if (failed.role !== "ai" || failed.status !== "failed" || failed.replaced_at !== null || latest?.id !== failed.id) {
      throw new ConflictError("not_retryable", "Only the latest failed AI reply can be retried");
    }

    await trx.updateTable("messages").set({ replaced_at: new Date() }).where("id", "=", failed.id).execute();
    const pending = await trx
      .insertInto("messages")
      .values({
        node_id: failed.node_id,
        seq: failed.seq,
        role: "ai",
        content: "",
        status: "pending",
        provenance: "ai_suggested",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx.updateTable("messages").set({ replaced_by: pending.id }).where("id", "=", failed.id).execute();
    return { nodeId: failed.node_id, pendingId: pending.id };
  });

  const aiMessage = await completeReply(nodeId, pendingId);
  return { aiMessage: toMessage(aiMessage) };
}
