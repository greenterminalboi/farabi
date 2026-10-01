import type { ColumnType, Generated } from "kysely";

export type Provenance = "ai_suggested" | "user_confirmed" | "user_authored";
export type MessageRole = "user" | "ai";
export type MessageStatus = "pending" | "complete" | "failed" | "incomplete" | "stopped";
export type MarkerKind = "selection" | "whole_message";
export type NodeOrigin = "root" | "branch" | "quick_branch" | "parked" | "function";
export type SourcePart = "summary" | "conversation" | "anchor";

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
  /** A registered node kind (Feature 9); "conversation" for every node before it. */
  kind: string;
  origin: NodeOrigin;
  function_id: ColumnType<string | null, string | null | undefined, never>;
  function_version: ColumnType<number | null, number | null | undefined, never>;
  /** Keys declared by the kind (FR-035). Inserted as a JSON string; read back parsed. */
  properties: ColumnType<Record<string, unknown>, string | undefined, never>;
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
  /** Information pressure level the reply started with (Feature 6); set once, at insert. */
  pressure_level: ColumnType<number | null, number | null | undefined, never>;
  /** Resolved model the reply was requested from (Feature 6); set once, at insert. */
  reply_model: ColumnType<string | null, string | null | undefined, never>;
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

export type SettingKey = "information_pressure" | "reply_model";

/** Append-only history of global settings (Feature 6); the newest row per key is in effect. */
export interface SettingChangesTable {
  id: Generated<string>;
  key: SettingKey;
  /** Inserted as a JSON string; read back parsed. */
  value: ColumnType<unknown, string, never>;
  provenance: ColumnType<Provenance, never, never>;
  created_at: CreatedAt;
}

/** A tangent parked from a node (Feature 8); insert-only, its state lives in its events. */
export interface ParkedTangentsTable {
  id: Generated<string>;
  node_id: string;
  message_id: string;
  start_offset: number;
  end_offset: number;
  anchor_text: string;
  prefix: string;
  suffix: string;
  provenance: ColumnType<Provenance, never, never>;
  created_at: CreatedAt;
}

export type ParkedEventKind = "question_set" | "discarded" | "fired";

/** Append-only history of a parked tangent: question edits, then at most one discard or fire. */
export interface ParkedTangentEventsTable {
  id: Generated<string>;
  tangent_id: string;
  kind: ParkedEventKind;
  question: string | null;
  child_node_id: string | null;
  provenance: ColumnType<Provenance, never, never>;
  created_at: CreatedAt;
}

/** The directed link from a function's input node to its output node (Feature 9); insert-only. */
export interface PipesTable {
  node_id: string;
  input_node_id: string;
  output_node_id: string;
  reads: SourcePart;
  function_id: string;
  function_version: number;
  created_at: CreatedAt;
}

/** One generated text for a function output (Feature 9); insert-only, always ai_suggested. */
export interface FunctionOutputVersionsTable {
  id: Generated<string>;
  output_node_id: string;
  text: string;
  /** Version of the input part that was read; for a summary, its node_summaries id. */
  source_version: string;
  function_version: number;
  /** Resolved settings used. Inserted as a JSON string; read back parsed. */
  settings: ColumnType<Record<string, string>, string, never>;
  provenance: ColumnType<Provenance, never, never>;
  created_at: CreatedAt;
}

export type OutputEventKind = "confirmed" | "rejected";

/** The user's review of a function output (Feature 9); insert-only, the newest event wins. */
export interface FunctionOutputEventsTable {
  id: Generated<string>;
  output_node_id: string;
  kind: OutputEventKind;
  version_id: string | null;
  provenance: Provenance;
  created_at: CreatedAt;
}

/** History of kind settings (Feature 9): kind-level when node_id is null, else a node override. */
export interface KindSettingChangesTable {
  id: Generated<string>;
  kind: string;
  key: string;
  node_id: string | null;
  /** Inserted as a JSON string (or null to clear); read back parsed. */
  value: ColumnType<unknown, string | null, never>;
  provenance: ColumnType<Provenance, never, never>;
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
  setting_changes: SettingChangesTable;
  parked_tangents: ParkedTangentsTable;
  parked_tangent_events: ParkedTangentEventsTable;
  pipes: PipesTable;
  function_output_versions: FunctionOutputVersionsTable;
  function_output_events: FunctionOutputEventsTable;
  kind_setting_changes: KindSettingChangesTable;
  feedback_items: FeedbackItemsTable;
  feedback_tags: FeedbackTagsTable;
  feedback_attachments: FeedbackAttachmentsTable;
  feedback_state_events: FeedbackStateEventsTable;
}
