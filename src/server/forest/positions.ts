import type { MapNode } from "@/shared/schemas";
import { db } from "../db/client";
import { ConflictError, NotFoundError } from "../errors";
import { assertId } from "../ids";
import { outputStates, toOutputSummary } from "../functions/state";
import { NO_SUMMARY, toMapNode, toSummary } from "../mappers";
import { getIncomingMarker, latestSummary } from "./nodeView";

/**
 * Stores a node's hand-placed position, relative to its tree's origin (FR-016, FR-017).
 * Only the position changes; the node's parent is never touched (FR-018).
 */
export async function setNodePosition(nodeId: string, x: number, y: number): Promise<MapNode> {
  assertId(nodeId, "Node");
  const node = await db.selectFrom("nodes").selectAll().where("id", "=", nodeId).executeTakeFirst();
  if (!node) throw new NotFoundError("Node not found");
  // A pipe follows its two ends; a function output moves on its own (Feature 9, FR-039).
  if (node.kind === "pipe") throw new ConflictError("wrong_kind", "A pipe has no position of its own", { kind: node.kind });
  if (node.kind === "conversation" && node.parent_id === null) {
    throw new ConflictError("root_node", "A root is moved by moving its tree");
  }
  const updated = await db
    .updateTable("nodes")
    .set({ manual_x: x, manual_y: y })
    .where("id", "=", nodeId)
    .returningAll()
    .executeTakeFirstOrThrow();
  if (updated.kind !== "conversation") {
    const state = (await outputStates([nodeId])).get(nodeId);
    return toMapNode(updated, null, NO_SUMMARY, null, 0, state ? toOutputSummary(state) : null);
  }
  const [incoming, summary] = await Promise.all([getIncomingMarker(nodeId), latestSummary(nodeId)]);
  const anchorText = incoming?.anchor_text ?? null;
  return toMapNode(updated, anchorText, toSummary(summary, anchorText));
}
