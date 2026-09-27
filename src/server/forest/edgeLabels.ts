import { sql } from "kysely";
import type { MapNode } from "@/shared/schemas";
import { db } from "../db/client";
import { ConflictError, InvalidRequestError, NotFoundError } from "../errors";
import { assertId } from "../ids";
import { toMapNode, toSummary } from "../mappers";
import { getIncomingMarker, latestSummary } from "./nodeView";

const MAX_LABEL = 200;

/**
 * Sets, changes or clears the label on the edge from a node to its parent (FR-023–FR-026).
 * Every change is a new user-authored version; clearing stores an empty (NULL) version (Article VI).
 */
export async function setEdgeLabel(childNodeId: string, text: string | null): Promise<MapNode> {
  assertId(childNodeId, "Node");
  const node = await db.selectFrom("nodes").selectAll().where("id", "=", childNodeId).executeTakeFirst();
  if (!node) throw new NotFoundError("Node not found");
  if (node.parent_id === null) throw new ConflictError("root_node", "A root has no edge to label");
  const label = text?.trim().replace(/\s+/g, " ") || null;
  if (label && label.length > MAX_LABEL) throw new InvalidRequestError(`Labels are limited to ${MAX_LABEL} characters`);
  await db
    .insertInto("edge_label_versions")
    .values({ child_node_id: childNodeId, text: label, provenance: "user_authored" })
    .execute();
  const [incoming, summary] = await Promise.all([getIncomingMarker(childNodeId), latestSummary(childNodeId)]);
  const anchorText = incoming?.anchor_text ?? null;
  return toMapNode(node, anchorText, toSummary(summary, anchorText), label);
}

/** Current label per edge (latest version; NULL when cleared). */
export async function currentEdgeLabels(): Promise<Map<string, string | null>> {
  const { rows } = await sql<{ child_node_id: string; text: string | null }>`
    SELECT DISTINCT ON (child_node_id) child_node_id, text
    FROM edge_label_versions
    ORDER BY child_node_id, created_at DESC, id DESC
  `.execute(db);
  return new Map(rows.map((r) => [r.child_node_id, r.text]));
}
