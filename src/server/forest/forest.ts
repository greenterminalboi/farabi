import { sql } from "kysely";
import type { ForestResponse } from "@/shared/schemas";
import { db } from "../db/client";
import { toMapNode, toSummary, toTree } from "../mappers";
import { currentEdgeLabels } from "./edgeLabels";

/** The whole forest for the map (FR-017, FR-021). */
export async function getForest(): Promise<ForestResponse> {
  const [trees, nodes, anchors, summaries, labels] = await Promise.all([
    db.selectFrom("trees").selectAll().orderBy("created_at", "asc").execute(),
    db.selectFrom("nodes").selectAll().orderBy("created_at", "asc").execute(),
    db.selectFrom("branch_markers").select(["child_node_id", "anchor_text"]).execute(),
    sql<{
      node_id: string;
      text: string;
      provenance: "ai_suggested" | "user_confirmed" | "user_authored";
      through_message_id: string;
      created_at: Date;
    }>`
      SELECT DISTINCT ON (node_id) node_id, text, provenance, through_message_id, created_at
      FROM node_summaries
      ORDER BY node_id, created_at DESC, id DESC
    `.execute(db),
    currentEdgeLabels(),
  ]);

  const anchorByNode = new Map(anchors.map((a) => [a.child_node_id, a.anchor_text]));
  const summaryByNode = new Map(summaries.rows.map((s) => [s.node_id, s]));

  return {
    trees: trees.map(toTree),
    nodes: nodes.map((n) => {
      const anchorText = anchorByNode.get(n.id) ?? null;
      return toMapNode(n, anchorText, toSummary(summaryByNode.get(n.id), anchorText), labels.get(n.id) ?? null);
    }),
  };
}
