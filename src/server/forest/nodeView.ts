import type { Anchor, NodeView } from "@/shared/schemas";
import { db } from "../db/client";
import { NotFoundError } from "../errors";
import { assertId } from "../ids";
import { toMapNode, toMarker, toMessage, toSummary } from "../mappers";
import { finalizeOrphan } from "../messages/generation";
import { getInheritedContext } from "./inheritedContext";

export async function latestSummary(nodeId: string) {
  return db
    .selectFrom("node_summaries")
    .selectAll()
    .where("node_id", "=", nodeId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
}

export async function getIncomingMarker(nodeId: string) {
  return db
    .selectFrom("branch_markers")
    .selectAll()
    .where("child_node_id", "=", nodeId)
    .executeTakeFirst();
}

/** Live (non-replaced) messages of a node in order. */
export async function liveMessages(nodeId: string) {
  return db
    .selectFrom("messages")
    .selectAll()
    .where("node_id", "=", nodeId)
    .where("replaced_at", "is", null)
    .orderBy("seq", "asc")
    .execute();
}

/** Live messages, with any orphaned pending reply finalised as incomplete first (research R2). */
async function liveMessagesFinalized(nodeId: string) {
  const rows = await liveMessages(nodeId);
  return Promise.all(rows.map((row) => finalizeOrphan(row)));
}

/** Everything the chat view needs for one node (GET /api/nodes/{nodeId}). */
export async function getNodeView(nodeId: string): Promise<NodeView> {
  assertId(nodeId, "Node");
  const node = await db.selectFrom("nodes").selectAll().where("id", "=", nodeId).executeTakeFirst();
  if (!node) throw new NotFoundError("Node not found");

  const [incoming, summary, messages, markers, inheritedContext] = await Promise.all([
    getIncomingMarker(nodeId),
    latestSummary(nodeId),
    liveMessagesFinalized(nodeId),
    db
      .selectFrom("branch_markers")
      .selectAll()
      .where("parent_node_id", "=", nodeId)
      .orderBy("created_at", "asc")
      .execute(),
    getInheritedContext(nodeId),
  ]);

  const anchorText = incoming?.anchor_text ?? null;
  const anchor: Anchor | null = incoming
    ? {
        messageId: incoming.message_id,
        start: incoming.start_offset,
        end: incoming.end_offset,
        text: incoming.anchor_text,
        prefix: incoming.prefix,
        suffix: incoming.suffix,
      }
    : null;

  // FR-029: only the latest live message, if it is a complete AI reply with no branches from it.
  const latest = messages.at(-1);
  const canRegenerate =
    latest &&
    latest.role === "ai" &&
    latest.status === "complete" &&
    !markers.some((m) => m.message_id === latest.id)
      ? { messageId: latest.id }
      : null;

  return {
    node: toMapNode(node, anchorText, toSummary(summary, anchorText)),
    anchor,
    inheritedContext,
    messages: messages.map(toMessage),
    markers: markers.map(toMarker),
    canRegenerate,
  };
}
