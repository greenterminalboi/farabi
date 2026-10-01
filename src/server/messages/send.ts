import { sql } from "kysely";
import type { SendMessageResponse } from "@/shared/schemas";
import { db, type Trx } from "../db/client";
import { ConflictError, InvalidRequestError, NotFoundError } from "../errors";
import { assertId } from "../ids";
import { assertConversation } from "../nodes/kinds";
import { resolveReplyModel } from "../ai";
import { toMessage } from "../mappers";
import { getSettings } from "../settings/settings";
import { startGeneration } from "./generation";
import { QUICK_BRANCH, tryQuickBranch } from "./quickBranch";
import { buildReplyInput } from "./replyInput";

/** Locks a node's row for the rest of the transaction, serializing message writes per node. */
export async function lockNode(trx: Trx, nodeId: string): Promise<void> {
  await sql`SELECT 1 FROM nodes WHERE id = ${nodeId} FOR UPDATE`.execute(trx);
}

/**
 * Inserts a pending AI message at `seq`. It records the level and model in effect right now, so the
 * reply keeps them whatever changes later (Feature 6, FR-009, FR-019). The only place AI messages
 * are created.
 */
export async function insertPendingReply(trx: Trx, nodeId: string, seq: number) {
  const settings = await getSettings(trx);
  return trx
    .insertInto("messages")
    .values({
      node_id: nodeId,
      seq,
      role: "ai",
      content: "",
      status: "pending",
      provenance: "ai_suggested",
      pressure_level: settings.informationPressure,
      reply_model: resolveReplyModel(settings.replyModel),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export function generate(nodeId: string, messageId: string) {
  return startGeneration(nodeId, messageId, () => buildReplyInput(nodeId, { replyMessageId: messageId }));
}

/**
 * Stores the user's message and a pending AI reply, starts the reply in the background and
 * returns immediately; the reply streams separately (Feature 2, FR-001, FR-004).
 */
export async function sendMessage(
  nodeId: string,
  content: string,
): Promise<Extract<SendMessageResponse, { kind: "message" }>> {
  assertId(nodeId, "Node");
  if (content.trim() === "") throw new InvalidRequestError("Message must not be empty");
  return sendOrdinary(nodeId, content);
}

/**
 * Entry point for the user's composer: an exact "????" becomes a quick branch when possible
 * (FR-006–FR-013); anything else is an ordinary message.
 */
export async function sendFromComposer(nodeId: string, content: string): Promise<SendMessageResponse> {
  assertId(nodeId, "Node");
  if (content.trim() === QUICK_BRANCH) {
    const branched = await tryQuickBranch(nodeId);
    if (branched) return branched;
  }
  return sendMessage(nodeId, content);
}

/**
 * Stores a user message and its pending AI reply inside `trx`; the caller starts generation after
 * commit. Serializes on the node row and refuses while a reply is still arriving.
 */
export async function insertUserTurn(trx: Trx, nodeId: string, content: string) {
  const node = await trx
    .selectFrom("nodes")
    .select(["id", "kind"])
    .where("id", "=", nodeId)
    .forUpdate()
    .executeTakeFirst();
  if (!node) throw new NotFoundError("Node not found");
  assertConversation(node);

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
  const pending = await insertPendingReply(trx, nodeId, seq + 1);
  return { userMessage, pending };
}

async function sendOrdinary(
  nodeId: string,
  content: string,
): Promise<Extract<SendMessageResponse, { kind: "message" }>> {
  const { userMessage, pending } = await db.transaction().execute((trx) => insertUserTurn(trx, nodeId, content));

  void generate(nodeId, pending.id);
  return { kind: "message", userMessage: toMessage(userMessage), aiMessage: toMessage(pending) };
}
