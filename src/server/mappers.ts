import type { Selectable } from "kysely";
import type {
  MapNode,
  MapPipe,
  MapTree,
  Marker,
  Message,
  OutputSummary,
  OutputVersion,
  ParkedTangent,
  Review,
  Summary,
} from "@/shared/schemas";
import type {
  BranchMarkersTable,
  FunctionOutputVersionsTable,
  MessagesTable,
  NodeSummariesTable,
  NodesTable,
  ParkedTangentsTable,
  PipesTable,
  TreesTable,
} from "./db/schema";
import { placeholderFor } from "./summaries/placeholder";

const iso = (d: Date) => d.toISOString();

/** Function outputs have no summary of their own; their label is their text (Feature 9, FR-018). */
export const NO_SUMMARY: Summary = { kind: "placeholder", text: "" };

export function toMessage(m: Selectable<MessagesTable>): Message {
  return {
    id: m.id,
    seq: m.seq,
    role: m.role,
    content: m.content,
    status: m.status,
    provenance: m.provenance,
    createdAt: iso(m.created_at),
    partialContent: m.partial_content,
    pressureLevel: m.pressure_level,
    replyModel: m.reply_model,
  };
}

export function toMarker(m: Selectable<BranchMarkersTable>): Marker {
  return {
    id: m.id,
    messageId: m.message_id,
    start: m.start_offset,
    end: m.end_offset,
    anchorText: m.anchor_text,
    childNodeId: m.child_node_id,
    kind: m.kind,
  };
}

export function toParkedTangent(t: Selectable<ParkedTangentsTable>, question: string | null): ParkedTangent {
  return {
    id: t.id,
    nodeId: t.node_id,
    anchor: {
      messageId: t.message_id,
      start: t.start_offset,
      end: t.end_offset,
      text: t.anchor_text,
      prefix: t.prefix,
      suffix: t.suffix,
    },
    question,
    createdAt: iso(t.created_at),
  };
}

export function toTree(t: Selectable<TreesTable>): MapTree {
  return {
    id: t.id,
    rootNodeId: t.root_node_id,
    origin: { x: t.layout_origin_x, y: t.layout_origin_y },
    userPlaced: t.user_placed,
  };
}

export function toSummary(
  latest: Pick<Selectable<NodeSummariesTable>, "text" | "provenance" | "through_message_id" | "created_at"> | null | undefined,
  anchorText: string | null,
): Summary {
  if (!latest) return placeholderFor(anchorText);
  return {
    kind: "summary",
    text: latest.text,
    provenance: latest.provenance,
    throughMessageId: latest.through_message_id,
    createdAt: iso(latest.created_at),
  };
}

export function toMapNode(
  n: Selectable<NodesTable>,
  anchorText: string | null,
  summary: Summary,
  edgeLabel: string | null = null,
  messageCount = 0,
  output: OutputSummary | null = null,
): MapNode {
  return {
    id: n.id,
    treeId: n.tree_id,
    parentId: n.parent_id,
    // Outputs and pipes have no parent either, but only a conversation can be a root (Feature 9).
    isRoot: n.kind === "conversation" && n.parent_id === null,
    anchorText,
    summary,
    createdAt: iso(n.created_at),
    manual: n.manual_x !== null && n.manual_y !== null ? { x: n.manual_x, y: n.manual_y } : null,
    edgeLabel,
    messageCount,
    kind: n.kind,
    origin: n.origin,
    output,
  };
}

/** A pipe node and its pipes row (Feature 9, FR-014). Its state is its output's review. */
export function toMapPipe(
  node: Pick<Selectable<NodesTable>, "id" | "tree_id" | "created_at">,
  pipe: Selectable<PipesTable>,
  functionName: string,
  state: Review,
): MapPipe {
  return {
    id: node.id,
    treeId: node.tree_id,
    inputNodeId: pipe.input_node_id,
    outputNodeId: pipe.output_node_id,
    reads: pipe.reads,
    functionId: pipe.function_id,
    functionName,
    functionVersion: pipe.function_version,
    state,
    createdAt: iso(node.created_at),
  };
}

export function toOutputVersion(v: Selectable<FunctionOutputVersionsTable>, confirmedId: string | null): OutputVersion {
  return {
    id: v.id,
    text: v.text,
    sourceVersion: v.source_version,
    functionVersion: v.function_version,
    settings: v.settings,
    provenance: "ai_suggested",
    confirmed: v.id === confirmedId,
    createdAt: iso(v.created_at),
  };
}
