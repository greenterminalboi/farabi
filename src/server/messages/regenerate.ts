import type { Message } from "@/shared/schemas";
import { db } from "../db/client";
import { ConflictError, NotFoundError } from "../errors";
import { assertId } from "../ids";
import { toMessage } from "../mappers";
import { hasLiveParkedOn } from "../parked/state";
import { generate, insertPendingReply, lockNode } from "./send";

/**
 * Regenerates the latest AI reply (Feature 1 FR-029, FR-030). The old reply is kept, marked
 * replaced, and the new one streams in its place. If the new attempt fails, it can be retried.
 */
export async function regenerateReply(
  messageId: string,
): Promise<{ aiMessage: Message; replaced: { id: string; replacedAt: string } }> {
  assertId(messageId, "Message");
  const result = await db.transaction().execute(async (trx) => {
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
    if (old.role !== "ai" || old.status !== "complete" || old.replaced_at !== null || latest?.id !== old.id) {
      throw new ConflictError("not_latest_ai_message", "Only the latest AI reply can be regenerated");
    }
    const branched = await trx
      .selectFrom("branch_markers")
      .select("id")
      .where("message_id", "=", old.id)
      .limit(1)
      .executeTakeFirst();
    if (branched) throw new ConflictError("has_branches", "This reply has branches, so it can't be regenerated");
    // A live parked tangent would point at a hidden reply (Feature 8, research R6).
    if (await hasLiveParkedOn(trx, old.id)) {
      throw new ConflictError("has_parked", "This reply has parked tangents, so it can't be regenerated");
    }

    const replacedAt = new Date();
    await trx.updateTable("messages").set({ replaced_at: replacedAt }).where("id", "=", old.id).execute();
    const pending = await insertPendingReply(trx, old.node_id, old.seq);
    await trx.updateTable("messages").set({ replaced_by: pending.id }).where("id", "=", old.id).execute();
    return { pending, replaced: { id: old.id, replacedAt: replacedAt.toISOString() } };
  });

  void generate(result.pending.node_id, result.pending.id);
  return { aiMessage: toMessage(result.pending), replaced: result.replaced };
}
