import type { ColumnType, Generated } from "kysely";

export type Provenance = "ai_suggested" | "user_confirmed" | "user_authored";
export type MessageRole = "user" | "ai";
export type MessageStatus = "pending" | "complete" | "failed" | "incomplete" | "stopped";
export type MarkerKind = "selection" | "whole_message";

type CreatedAt = ColumnType<Date, never, never>;

export interface ProjectsTable {
  id: Generated<string>;
  name: string;
  created_at: CreatedAt;
  trashed_at: Date | null;
}

export interface TreesTable {
  id: Generated<string>;
  project_id: string;
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
  project_id: string;
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

export type FeedbackView = "chat" | "map" | "definitions";
export type FeedbackState = "open" | "addressed" | "resolved";

export interface FeedbackItemsTable {
  id: Generated<string>;
  text: string;
  view: FeedbackView;
  node_id: string | null;
  rank: string | null;
  provenance: Provenance;
  created_at: CreatedAt;
}

export interface FeedbackTagsTable {
  id: Generated<string>;
  item_id: string;
  text: string;
  tag_key: string;
  provenance: Provenance;
  created_at: CreatedAt;
}

export interface FeedbackAttachmentsTable {
  id: Generated<string>;
  item_id: string;
  file_path: string;
  thumb_path: string | null;
  original_name: string | null;
  mime_type: string;
  byte_size: number;
  sha256: string;
  provenance: Provenance;
  created_at: CreatedAt;
}

export interface FeedbackStateEventsTable {
  id: Generated<string>;
  item_id: string;
  state: FeedbackState;
  provenance: Provenance;
  created_at: CreatedAt;
}

export interface Database {
  projects: ProjectsTable;
  trees: TreesTable;
  nodes: NodesTable;
  branch_markers: BranchMarkersTable;
  messages: MessagesTable;
  node_summaries: NodeSummariesTable;
  edge_label_versions: EdgeLabelVersionsTable;
  definitions: DefinitionsTable;
  definition_versions: DefinitionVersionsTable;
  feedback_items: FeedbackItemsTable;
  feedback_tags: FeedbackTagsTable;
  feedback_attachments: FeedbackAttachmentsTable;
  feedback_state_events: FeedbackStateEventsTable;
}
