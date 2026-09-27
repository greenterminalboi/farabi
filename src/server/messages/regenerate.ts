import type { Message } from "@/shared/schemas";
import { getAIProvider } from "../ai";
import { AIUnavailableError } from "../ai/provider";
import { db } from "../db/client";
import { AIServiceUnavailable, ConflictError, NotFoundError } from "../errors";
import { assertId } from "../ids";
import { toMessage } from "../mappers";
import { summaryAfterReply } from "../summaries/queue";
import { buildReplyInput } from "./replyInput";
import { lockNode } from "./send";

async function assertRegenerable(
  exec: Pick<typeof db, "selectFrom">,
  message: { id: string; node_id: string; role: string; status: string; replaced_at: Date | null },
): Promise<void> {
  const latest = await exec
    .selectFrom("messages")
    .select("id")
    .where("node_id", "=", message.node_id)
    .where("replaced_at", "is", null)
    .orderBy("seq", "desc")
    .limit(1)
    .executeTakeFirst();
  if (
    message.role !== "ai" ||
    message.status !== "complete" ||
    message.replaced_at !== null ||
    latest?.id !== message.id
  ) {
    throw new ConflictError("not_latest_ai_message", "Only the latest AI reply can be regenerated");
  }
  const branched = await exec
    .selectFrom("branch_markers")
    .select("id")
    .where("message_id", "=", message.id)
    .limit(1)
    .executeTakeFirst();
  if (branched) {
    throw new ConflictError("has_branches", "This reply has branches, so it can't be regenerated");
  }
}

/**
 * Regenerates the latest AI reply (FR-029, FR-030). The new reply is produced first; only on
 * success is the old one marked replaced (kept, not deleted) and the new one stored.
 */
export async function regenerateReply(
  messageId: string,
): Promise<{ aiMessage: Message; replaced: { id: string; replacedAt: string } }> {
  assertId(messageId, "Message");
  const old = await db.selectFrom("messages").selectAll().where("id", "=", messageId).executeTakeFirst();
  if (!old) throw new NotFoundError("Message not found");
  await assertRegenerable(db, old);

  let content: string;
  try {
    content = await getAIProvider().reply(
      await buildReplyInput(old.node_id, { excludeMessageId: old.id }),
    );
  } catch (err) {
    if (err instanceof AIUnavailableError) throw new AIServiceUnavailable();
    throw err;
  }

  const result = await db.transaction().execute(async (trx) => {
    await lockNode(trx, old.node_id);
    const current = await trx.selectFrom("messages").selectAll().where("id", "=", old.id).executeTakeFirstOrThrow();
    await assertRegenerable(trx, current); // state may have changed while the AI was replying

    const replacedAt = new Date();
    await trx.updateTable("messages").set({ replaced_at: replacedAt }).where("id", "=", old.id).execute();
    const fresh = await trx
      .insertInto("messages")
      .values({
        node_id: old.node_id,
        seq: old.seq,
        role: "ai",
        content,
        status: "complete",
        provenance: "ai_suggested",
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await trx.updateTable("messages").set({ replaced_by: fresh.id }).where("id", "=", old.id).execute();
    return { aiMessage: toMessage(fresh), replaced: { id: old.id, replacedAt: replacedAt.toISOString() } };
  });

  summaryAfterReply(old.node_id);
  return result;
}
