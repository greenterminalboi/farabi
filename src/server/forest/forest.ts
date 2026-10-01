import { sql } from "kysely";
import type { ForestResponse } from "@/shared/schemas";
import { db } from "../db/client";
import { findFunction } from "../functions/definitions";
import { outputStates, toOutputSummary } from "../functions/state";
import { NO_SUMMARY, toMapNode, toMapPipe, toSummary, toTree } from "../mappers";
import { currentEdgeLabels } from "./edgeLabels";

/** The open project's forest for the map (FR-017, FR-021; Feature 4 FR-005). */
export async function getForest(projectId: string): Promise<ForestResponse> {
  const [trees, nodes, anchors, summaries, labels, counts] = await Promise.all([
    db.selectFrom("trees").selectAll().where("project_id", "=", projectId).orderBy("created_at", "asc").execute(),
    db
      .selectFrom("nodes")
      .innerJoin("trees", "trees.id", "nodes.tree_id")
      .selectAll("nodes")
      .where("trees.project_id", "=", projectId)
      .orderBy("nodes.created_at", "asc")
      .execute(),
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
    sql<{ node_id: string; n: number }>`
      SELECT node_id, count(*)::int AS n FROM messages WHERE replaced_at IS NULL GROUP BY node_id
    `.execute(db),
  ]);
  const countByNode = new Map(counts.rows.map((c) => [c.node_id, c.n]));

  const anchorByNode = new Map(anchors.map((a) => [a.child_node_id, a.anchor_text]));
  const summaryByNode = new Map(summaries.rows.map((s) => [s.node_id, s]));

  // Function outputs are boxes labelled with their text; pipes are connectors (Feature 9, R6).
  const conversations = nodes.filter((n) => n.kind === "conversation");
  const outputs = nodes.filter((n) => n.kind !== "conversation" && n.kind !== "pipe");
  const states = await outputStates(outputs.map((n) => n.id));
  const pipeNodes = new Map(nodes.filter((n) => n.kind === "pipe").map((n) => [n.id, n]));

  return {
    trees: trees.map(toTree),
    nodes: [
      ...conversations.map((n) => {
        const anchorText = anchorByNode.get(n.id) ?? null;
        return toMapNode(
          n,
          anchorText,
          toSummary(summaryByNode.get(n.id), anchorText),
          labels.get(n.id) ?? null,
          countByNode.get(n.id) ?? 0,
        );
      }),
      ...outputs.flatMap((n) => {
        const state = states.get(n.id);
        return state ? [toMapNode(n, null, NO_SUMMARY, null, 0, toOutputSummary(state))] : [];
      }),
    ],
    pipes: [...states.values()].flatMap((state) => {
      const node = pipeNodes.get(state.pipe.node_id);
      if (!node) return [];
      const name = findFunction(state.pipe.function_id)?.name ?? state.pipe.function_id;
      return [toMapPipe(node, state.pipe, name, state.review)];
    }),
  };
}
