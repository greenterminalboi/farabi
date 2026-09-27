import type { ColumnType, Generated } from "kysely";

export type Provenance = "ai_suggested" | "user_confirmed" | "user_authored";
export type MessageRole = "user" | "ai";
export type MessageStatus = "pending" | "complete" | "failed" | "incomplete" | "stopped";
export type MarkerKind = "selection" | "whole_message";

type CreatedAt = ColumnType<Date, never, never>;

export interface TreesTable {
  id: Generated<string>;
  root_node_id: string;
  layout_origin_x: number;
  layout_origin_y: number;
  user_placed: Generated<boolean>;
  created_at: CreatedAt;
}

export interface NodesTable {
  id: Generated<string>;
  tree_id: string;
  parent_id: string | null;
  provenance: Provenance;
  manual_x: number | null;
  manual_y: number | null;
  created_at: CreatedAt;
}

export interface BranchMarkersTable {
  id: Generated<string>;
  parent_node_id: string;
  message_id: string;
  child_node_id: string;
  start_offset: number;
  end_offset: number;
  anchor_text: string;
  prefix: string;
  suffix: string;
  kind: Generated<MarkerKind>;
  provenance: Provenance;
  created_at: CreatedAt;
}

export interface MessagesTable {
  id: Generated<string>;
  node_id: string;
  seq: number;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  provenance: Provenance;
  replaced_at: Date | null;
  replaced_by: string | null;
  partial_content: string | null;
  created_at: CreatedAt;
}

export interface NodeSummariesTable {
  id: Generated<string>;
  node_id: string;
  text: string;
  provenance: Provenance;
  through_message_id: string;
  created_at: CreatedAt;
}

export interface EdgeLabelVersionsTable {
  id: Generated<string>;
  child_node_id: string;
  text: string | null;
  provenance: Provenance;
  created_at: CreatedAt;
}

export interface DefinitionsTable {
  id: Generated<string>;
  term: string;
  term_key: string;
  source_node_id: string;
  source_message_id: string;
  draft_failed_at: Date | null;
  created_at: CreatedAt;
}

export interface DefinitionVersionsTable {
  id: Generated<string>;
  definition_id: string;
  general_text: string;
  usage_text: string;
  provenance: Provenance;
  created_at: CreatedAt;
}

export interface Database {
  trees: TreesTable;
  nodes: NodesTable;
  branch_markers: BranchMarkersTable;
  messages: MessagesTable;
  node_summaries: NodeSummariesTable;
  edge_label_versions: EdgeLabelVersionsTable;
  definitions: DefinitionsTable;
  definition_versions: DefinitionVersionsTable;
}
