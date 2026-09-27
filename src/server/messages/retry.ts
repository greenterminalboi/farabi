import type { Message } from "@/shared/schemas";
import { db } from "../db/client";
import { ConflictError, NotFoundError } from "../errors";
import { assertId } from "../ids";
import { toMessage } from "../mappers";
import { generate, insertPendingReply, lockNode } from "./send";

const RETRYABLE = new Set(["failed", "incomplete", "stopped"]);

/**
 * Retries a failed, incomplete or stopped AI reply. The old row is kept, marked replaced
 * (Article VI); a new attempt streams in its place (FR-003).
 */
export async function retryReply(messageId: string): Promise<{ aiMessage: Message }> {
  assertId(messageId, "Message");
  const pending = await db.transaction().execute(async (trx) => {
    const old = await trx.selectFrom("messages").selectAll().where("id", "=", messageId).executeTakeFirst();
    if (!old) throw new NotFoundError("Message not found");
    await lockNode(trx, old.node_id);

    const latest = await trx
      .selectFrom("messages")
      .select("id")
      .where("node_id", "=", old.node_id)
      .where("replaced_at", "is", null)
      .orderBy("seq", "desc")
      .limit(1)
      .executeTakeFirst();
    if (old.role !== "ai" || !RETRYABLE.has(old.status) || old.replaced_at !== null || latest?.id !== old.id) {
      throw new ConflictError("not_retryable", "Only the latest failed, incomplete or stopped reply can be retried");
    }

    await trx.updateTable("messages").set({ replaced_at: new Date() }).where("id", "=", old.id).execute();
    const pending = await insertPendingReply(trx, old.node_id, old.seq);
    await trx.updateTable("messages").set({ replaced_by: pending.id }).where("id", "=", old.id).execute();
    return pending;
  });

  void generate(pending.node_id, pending.id);
  return { aiMessage: toMessage(pending) };
}
