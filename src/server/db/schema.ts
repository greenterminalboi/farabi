import type { ColumnType, Generated } from "kysely";

export type Provenance = "ai_suggested" | "user_confirmed" | "user_authored";
export type Shape = "node" | "edge";
export type ElementOrigin =
  | "origin"
  | "ask"
  | "branch"
  | "quick_branch"
  | "parked"
  | "reply"
  | "retry"
  | "regenerate"
  | "run"
  | "drill";
export type AnswerStatus = "pending" | "complete" | "incomplete" | "stopped" | "failed";
export type OutputReviewKind = "confirmed" | "rejected";

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
  /** World position of the origin edge's box. Presentation data, mutable (Feature 2). */
  layout_origin_x: number;
  layout_origin_y: number;
  /** Set once the user drags the tree; it then never moves automatically (FR-038). */
  user_placed: Generated<boolean>;
  created_at: CreatedAt;
}

/**
 * Every graph element (data-model.md, research R1). `nodes_guard` allows exactly four updates:
 * send (question text and sent_at, once), checkpoint (partial_text while pending), finalize
 * (status, text, partial_text cleared) and placement (manual_x/y). The column types keep
 * everything else insert-only.
 */
export interface NodesTable {
  id: Generated<string>;
  project_id: ColumnType<string, string, never>;
  tree_id: ColumnType<string, string, never>;
  parent_id: ColumnType<string | null, string | null, never>;
  kind: ColumnType<string, string, never>;
  shape: ColumnType<Shape, Shape, never>;
  origin: ColumnType<ElementOrigin, ElementOrigin, never>;
  provenance: ColumnType<Provenance, Provenance, never>;
  text: ColumnType<string | null, string | null | undefined, string>;
  status: ColumnType<AnswerStatus | null, AnswerStatus | null | undefined, AnswerStatus>;
  partial_text: ColumnType<string | null, string | null | undefined, string | null>;
  pressure_level: ColumnType<number | null, number | null | undefined, never>;
  reply_model: ColumnType<string | null, string | null | undefined, never>;
  anchor_start: ColumnType<number | null, number | null | undefined, never>;
  anchor_end: ColumnType<number | null, number | null | undefined, never>;
  anchor_text: ColumnType<string | null, string | null | undefined, never>;
  anchor_prefix: ColumnType<string | null, string | null | undefined, never>;
  anchor_suffix: ColumnType<string | null, string | null | undefined, never>;
  requery_of: ColumnType<string | null, string | null | undefined, never>;
  function_id: ColumnType<string | null, string | null | undefined, never>;
  function_version: ColumnType<number | null, number | null | undefined, never>;
  /** Keys declared by the kind (FR-054). Inserted as a JSON string; read back parsed. */
  properties: ColumnType<Record<string, unknown>, string | undefined, never>;
  manual_x: ColumnType<number | null, number | null | undefined, number | null>;
  manual_y: ColumnType<number | null, number | null | undefined, number | null>;
  sent_at: ColumnType<Date | null, Date | string | null | undefined, Date | string>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

/** One short note per edge, kept as history; the newest row is current (FR-040). */
export interface EdgeNotesTable {
  id: Generated<string>;
  edge_id: string;
  text: string | null;
  provenance: ColumnType<Provenance, never, never>;
  created_at: CreatedAt;
}

/** The user's review of a function output (FR-050); append-only, the newest row wins. */
export interface OutputReviewsTable {
  id: Generated<string>;
  node_id: string;
  kind: OutputReviewKind;
  provenance: Provenance;
  created_at: CreatedAt;
}

/** Saved camera per project, written after 500 ms idle (FR-028). Presentation, mutable. */
export interface ProjectCamerasTable {
  project_id: string;
  x: number;
  y: number;
  scale: number;
  updated_at: Generated<Date>;
}

/** How each v1 row became v2 rows (contracts/migration.md); append-only. */
export interface V1ConversionTable {
  id: Generated<string>;
  v1_table: string;
  v1_id: string;
  v2_id: string | null;
  detail: ColumnType<Record<string, unknown>, string | undefined, never>;
  created_at: CreatedAt;
}

/** Row count and digest of each frozen v1 table, taken at migration start (SC-003). */
export interface V1ChecksumsTable {
  table_name: string;
  row_count: ColumnType<string, number, never>;
  digest: string;
  taken_at: CreatedAt;
}

export interface DefinitionsTable {
  id: Generated<string>;
  project_id: string;
  term: string;
  term_key: string;
  /** The element the term was captured from (FR-055). */
  source_id: string | null;
  /** v1 conversation and message, kept on definitions captured before v0.2. */
  source_node_id: ColumnType<string | null, never, never>;
  source_message_id: ColumnType<string | null, never, never>;
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

/** A tangent parked from an element's text (Feature 8); insert-only, its state lives in its events. */
export interface ParkedTangentsTable {
  id: Generated<string>;
  node_id: string;
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
  /** The edge a `fired` event created. */
  edge_id: string | null;
  provenance: ColumnType<Provenance, never, never>;
  created_at: CreatedAt;
}

/** History of kind settings (Feature 9): kind-level when node_id is null, else a function edge override. */
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

export type FeedbackView = "chat" | "map" | "definitions" | "canvas";
export type FeedbackState = "open" | "addressed" | "resolved";

export interface FeedbackItemsTable {
  id: Generated<string>;
  text: string;
  view: FeedbackView;
  /** v1 conversation, on items captured before v0.2. */
  node_id: ColumnType<string | null, never, never>;
  project_id: string | null;
  /** The focused element when the item was captured (FR-058). */
  element_id: string | null;
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
  edge_notes: EdgeNotesTable;
  output_reviews: OutputReviewsTable;
  project_cameras: ProjectCamerasTable;
  v1_conversion: V1ConversionTable;
  v1_checksums: V1ChecksumsTable;
  definitions: DefinitionsTable;
  definition_versions: DefinitionVersionsTable;
  setting_changes: SettingChangesTable;
  parked_tangents: ParkedTangentsTable;
  parked_tangent_events: ParkedTangentEventsTable;
  kind_setting_changes: KindSettingChangesTable;
  feedback_items: FeedbackItemsTable;
  feedback_tags: FeedbackTagsTable;
  feedback_attachments: FeedbackAttachmentsTable;
  feedback_state_events: FeedbackStateEventsTable;
}
