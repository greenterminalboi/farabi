// The frozen v1 tables (research R2), typed for the converter and verifier only. Copied from the
// Feature 9 schema; these rows never change, so every column is read-only to the app. Test
// fixtures insert through these types.
import type { ColumnType, Generated } from "kysely";
import type { Provenance } from "../schema";

type CreatedAt = ColumnType<Date, Date | string | undefined, never>;

export type V1MessageRole = "user" | "ai";
export type V1MessageStatus = "pending" | "complete" | "failed" | "incomplete" | "stopped";
export type V1MarkerKind = "selection" | "whole_message";
export type V1NodeOrigin = "root" | "branch" | "quick_branch" | "parked" | "function";

export interface V1TreesTable {
  id: Generated<string>;
  project_id: string | null;
  root_node_id: string;
  layout_origin_x: number;
  layout_origin_y: number;
  user_placed: Generated<boolean>;
  created_at: CreatedAt;
}

export interface V1NodesTable {
  id: Generated<string>;
  tree_id: string;
  parent_id: string | null;
  provenance: Provenance;
  manual_x: number | null;
  manual_y: number | null;
  kind: string;
  origin: V1NodeOrigin;
  function_id: string | null;
  function_version: number | null;
  properties: ColumnType<Record<string, unknown>, string | undefined, never>;
  created_at: CreatedAt;
}

export interface V1BranchMarkersTable {
  id: Generated<string>;
  parent_node_id: string;
  message_id: string;
  child_node_id: string;
  start_offset: number;
  end_offset: number;
  anchor_text: string;
  prefix: string;
  suffix: string;
  kind: Generated<V1MarkerKind>;
  provenance: Provenance;
  created_at: CreatedAt;
}

export interface V1MessagesTable {
  id: Generated<string>;
  node_id: string;
  seq: number;
  role: V1MessageRole;
  content: string;
  status: V1MessageStatus;
  provenance: Provenance;
  replaced_at: Date | string | null;
  replaced_by: string | null;
  partial_content: string | null;
  pressure_level: number | null;
  reply_model: string | null;
  created_at: CreatedAt;
}

export interface V1NodeSummariesTable {
  id: Generated<string>;
  node_id: string;
  text: string;
  provenance: Provenance;
  through_message_id: string;
  created_at: CreatedAt;
}

export interface V1EdgeLabelVersionsTable {
  id: Generated<string>;
  child_node_id: string;
  text: string | null;
  provenance: Provenance;
  created_at: CreatedAt;
}

export interface V1ParkedTangentsTable {
  id: Generated<string>;
  node_id: string;
  message_id: string;
  start_offset: number;
  end_offset: number;
  anchor_text: string;
  prefix: string;
  suffix: string;
  provenance: Generated<Provenance>;
  created_at: CreatedAt;
}

export interface V1ParkedTangentEventsTable {
  id: Generated<string>;
  tangent_id: string;
  kind: "question_set" | "discarded" | "fired";
  question: string | null;
  child_node_id: string | null;
  provenance: Generated<Provenance>;
  created_at: CreatedAt;
}

export interface V1PipesTable {
  node_id: string;
  input_node_id: string;
  output_node_id: string;
  reads: "summary" | "conversation" | "anchor";
  function_id: string;
  function_version: number;
  created_at: CreatedAt;
}

export interface V1FunctionOutputVersionsTable {
  id: Generated<string>;
  output_node_id: string;
  text: string;
  source_version: string;
  function_version: number;
  settings: ColumnType<Record<string, string>, string, never>;
  provenance: Generated<Provenance>;
  created_at: CreatedAt;
}

export interface V1FunctionOutputEventsTable {
  id: Generated<string>;
  output_node_id: string;
  kind: "confirmed" | "rejected";
  version_id: string | null;
  provenance: Provenance;
  created_at: CreatedAt;
}

export interface V1KindSettingChangesTable {
  id: Generated<string>;
  kind: string;
  key: string;
  node_id: string | null;
  value: ColumnType<unknown, string | null, never>;
  provenance: Generated<Provenance>;
  created_at: CreatedAt;
}

export interface V1Database {
  "v1.trees": V1TreesTable;
  "v1.nodes": V1NodesTable;
  "v1.messages": V1MessagesTable;
  "v1.branch_markers": V1BranchMarkersTable;
  "v1.node_summaries": V1NodeSummariesTable;
  "v1.edge_label_versions": V1EdgeLabelVersionsTable;
  "v1.parked_tangents": V1ParkedTangentsTable;
  "v1.parked_tangent_events": V1ParkedTangentEventsTable;
  "v1.pipes": V1PipesTable;
  "v1.function_output_versions": V1FunctionOutputVersionsTable;
  "v1.function_output_events": V1FunctionOutputEventsTable;
  "v1.kind_setting_changes": V1KindSettingChangesTable;
}
