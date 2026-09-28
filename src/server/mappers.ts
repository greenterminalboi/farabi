import type { Selectable } from "kysely";
import type { MapNode, MapTree, Marker, Message, Summary } from "@/shared/schemas";
import type {
  BranchMarkersTable,
  MessagesTable,
  NodeSummariesTable,
  NodesTable,
  TreesTable,
} from "./db/schema";
import { placeholderFor } from "./summaries/placeholder";

const iso = (d: Date) => d.toISOString();

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
): MapNode {
  return {
    id: n.id,
    treeId: n.tree_id,
    parentId: n.parent_id,
    isRoot: n.parent_id === null,
    anchorText,
    summary,
    createdAt: iso(n.created_at),
    manual: n.manual_x !== null && n.manual_y !== null ? { x: n.manual_x, y: n.manual_y } : null,
    edgeLabel,
    messageCount,
  };
}
