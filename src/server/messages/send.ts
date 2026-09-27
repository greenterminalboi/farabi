import { sql } from "kysely";
import type { SendMessageResponse } from "@/shared/schemas";
import { getAIProvider } from "../ai";
import { AIUnavailableError } from "../ai/provider";
import { db, type Trx } from "../db/client";
import { AIServiceUnavailable, ConflictError, InvalidRequestError, NotFoundError } from "../errors";
import { assertId } from "../ids";
import { toMessage } from "../mappers";
import { summaryAfterReply } from "../summaries/queue";
import { buildReplyInput } from "./replyInput";

/**
 * Fills a pending AI message with the provider's reply. Content is written exactly once, at
 * completion (FR-028). On failure the message is marked failed and AIServiceUnavailable is thrown.
 */
export async function completeReply(nodeId: string, pendingId: string) {
  try {
    const content = await getAIProvider().reply(await buildReplyInput(nodeId));
    const done = await db
      .updateTable("messages")
      .set({ content, status: "complete" })
      .where("id", "=", pendingId)
      .where("status", "=", "pending")
      .returningAll()
      .executeTakeFirstOrThrow();
    summaryAfterReply(nodeId);
    return done;
  } catch (err) {
    await db
      .updateTable("messages")
      .set({ status: "failed" })
      .where("id", "=", pendingId)
      .where("status", "=", "pending")
      .execute();
    if (err instanceof AIUnavailableError) throw new AIServiceUnavailable();
    throw err;
  }
}

/** Stores the user's message, then obtains and stores the AI reply (FR-004, FR-032). */
export async function sendMessage(nodeId: string, content: string): Promise<SendMessageResponse> {
  assertId(nodeId, "Node");
  if (content.trim() === "") throw new InvalidRequestError("Message must not be empty");

  const { userMessage, pending } = await db.transaction().execute(async (trx) => {
    const node = await trx
      .selectFrom("nodes")
      .select("id")
      .where("id", "=", nodeId)
      .forUpdate()
      .executeTakeFirst();
    if (!node) throw new NotFoundError("Node not found");

    const latest = await trx
      .selectFrom("messages")
      .select(["seq", "status"])
      .where("node_id", "=", nodeId)
      .where("replaced_at", "is", null)
      .orderBy("seq", "desc")
      .limit(1)
      .executeTakeFirst();
    if (latest?.status === "pending") {
      throw new ConflictError("reply_in_progress", "Wait for the current reply to finish");
    }
    const seq = (latest?.seq ?? 0) + 1;

    const userMessage = await trx
      .insertInto("messages")
      .values({
        node_id: nodeId,
        seq,
        role: "user",
        content,
        status: "complete",
        provenance: "user_authored",
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const pending = await trx
      .insertInto("messages")
      .values({
        node_id: nodeId,
        seq: seq + 1,
        role: "ai",
        content: "",
        status: "pending",
        provenance: "ai_suggested",
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { userMessage, pending };
  });

  try {
    const aiMessage = await completeReply(nodeId, pending.id);
    return { userMessage: toMessage(userMessage), aiMessage: toMessage(aiMessage) };
  } catch (err) {
    if (err instanceof AIServiceUnavailable) {
      throw new AIServiceUnavailable({ userMessage: toMessage(userMessage) });
    }
    throw err;
  }
}

/** Locks a node's row for the rest of the transaction, serializing message writes per node. */
export async function lockNode(trx: Trx, nodeId: string): Promise<void> {
  await sql`SELECT 1 FROM nodes WHERE id = ${nodeId} FOR UPDATE`.execute(trx);
}
