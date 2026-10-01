import { sql } from "kysely";
import type { Anchor, NodeView } from "@/shared/schemas";
import { db } from "../db/client";
import { NotFoundError } from "../errors";
import { assertId } from "../ids";
import { assertConversation } from "../nodes/kinds";
import { toMapNode, toMarker, toMessage, toParkedTangent, toSummary } from "../mappers";
import { finalizeOrphan } from "../messages/generation";
import { liveParked } from "../parked/state";
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

/** A node's direct children as map nodes, newest first (Feature 8, FR-002). */
async function directChildren(nodeId: string) {
  const children = await db
    .selectFrom("nodes")
    .selectAll()
    .where("parent_id", "=", nodeId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
  if (children.length === 0) return [];
  const ids = children.map((c) => c.id);
  const [anchors, summaries, counts] = await Promise.all([
    db.selectFrom("branch_markers").select(["child_node_id", "anchor_text"]).where("child_node_id", "in", ids).execute(),
    db
      .selectFrom("node_summaries")
      .selectAll()
      .where("node_id", "in", ids)
      .distinctOn("node_id")
      .orderBy("node_id")
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .execute(),
    sql<{ node_id: string; n: number }>`
      SELECT node_id, count(*)::int AS n FROM messages
      WHERE replaced_at IS NULL AND node_id IN (${sql.join(ids)})
      GROUP BY node_id
    `.execute(db),
  ]);
  const anchorBy = new Map(anchors.map((a) => [a.child_node_id, a.anchor_text]));
  const summaryBy = new Map(summaries.map((s) => [s.node_id, s]));
  const countBy = new Map(counts.rows.map((c) => [c.node_id, c.n]));
  return children.map((c) => {
    const anchorText = anchorBy.get(c.id) ?? null;
    return toMapNode(c, anchorText, toSummary(summaryBy.get(c.id), anchorText), null, countBy.get(c.id) ?? 0);
  });
}

/** Everything the chat view needs for one node (GET /api/nodes/{nodeId}). */
export async function getNodeView(nodeId: string): Promise<NodeView> {
  assertId(nodeId, "Node");
  const node = await db.selectFrom("nodes").selectAll().where("id", "=", nodeId).executeTakeFirst();
  if (!node) throw new NotFoundError("Node not found");
  // Other kinds open their own view (Feature 9, FR-004).
  assertConversation(node);

  const [incoming, summary, messages, markers, inheritedContext, children, parked] = await Promise.all([
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
    directChildren(nodeId),
    liveParked(nodeId),
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

  // FR-029: only the latest live message, if it is a complete AI reply with no branches or live
  // parked tangents on it (Feature 8, research R6).
  const latest = messages.at(-1);
  const canRegenerate =
    latest &&
    latest.role === "ai" &&
    latest.status === "complete" &&
    !markers.some((m) => m.message_id === latest.id) &&
    !parked.some((p) => p.message_id === latest.id)
      ? { messageId: latest.id }
      : null;

  return {
    node: toMapNode(node, anchorText, toSummary(summary, anchorText)),
    anchor,
    inheritedContext,
    messages: messages.map(toMessage),
    markers: markers.map(toMarker),
    canRegenerate,
    children,
    parked: parked.map((p) => toParkedTangent(p, p.question)),
  };
}
