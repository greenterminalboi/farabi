// What a node function reads from its input node (Feature 9, research R4). Each reader returns the
// text and a version id that changes whenever that part changes, so an output can tell it is stale
// by comparing ids, with no AI call (FR-020–FR-022).
import { sql } from "kysely";
import { db } from "../db/client";
import type { SourcePart } from "../db/schema";

export type ReadResult = { ok: true; text: string; version: string } | { ok: false; reason: string };

export interface SourceReader {
  read(nodeId: string): Promise<ReadResult>;
  /** Current version per node, for many nodes at once (forest staleness). */
  currentVersions(nodeIds: string[]): Promise<Map<string, string>>;
}

const toMap = (rows: Array<{ node_id: string; version: string }>) => new Map(rows.map((r) => [r.node_id, r.version]));

/** The node's latest summary; its row id is the summary version (summaries are insert-only). */
const summary: SourceReader = {
  async read(nodeId) {
    const row = await db
      .selectFrom("node_summaries")
      .select(["id", "text"])
      .where("node_id", "=", nodeId)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(1)
      .executeTakeFirst();
    if (!row) return { ok: false, reason: "This conversation has no summary yet: it needs a completed AI reply." };
    return { ok: true, text: row.text, version: row.id };
  },
  async currentVersions(nodeIds) {
    if (nodeIds.length === 0) return new Map();
    const { rows } = await sql<{ node_id: string; version: string }>`
      SELECT DISTINCT ON (node_id) node_id, id AS version
      FROM node_summaries
      WHERE node_id IN (${sql.join(nodeIds)})
      ORDER BY node_id, created_at DESC, id DESC
    `.execute(db);
    return toMap(rows);
  },
};

/** The node's own live, complete messages; the last one's id is the version. */
const conversation: SourceReader = {
  async read(nodeId) {
    const messages = await db
      .selectFrom("messages")
      .select(["id", "role", "content"])
      .where("node_id", "=", nodeId)
      .where("replaced_at", "is", null)
      .where("status", "=", "complete")
      .orderBy("seq", "asc")
      .execute();
    const last = messages.at(-1);
    if (!last) return { ok: false, reason: "This conversation has no messages yet." };
    const text = messages.map((m) => `${m.role === "user" ? "Person" : "Assistant"}: ${m.content}`).join("\n\n");
    return { ok: true, text, version: last.id };
  },
  async currentVersions(nodeIds) {
    if (nodeIds.length === 0) return new Map();
    const { rows } = await sql<{ node_id: string; version: string }>`
      SELECT DISTINCT ON (node_id) node_id, id AS version
      FROM messages
      WHERE node_id IN (${sql.join(nodeIds)}) AND replaced_at IS NULL AND status = 'complete'
      ORDER BY node_id, seq DESC
    `.execute(db);
    return toMap(rows);
  },
};

/** The highlighted passage the node was branched from; the marker's id is the version. */
const anchor: SourceReader = {
  async read(nodeId) {
    const marker = await db
      .selectFrom("branch_markers")
      .select(["id", "anchor_text"])
      .where("child_node_id", "=", nodeId)
      .executeTakeFirst();
    if (!marker) return { ok: false, reason: "A starting conversation has no highlighted passage." };
    return { ok: true, text: marker.anchor_text, version: marker.id };
  },
  async currentVersions(nodeIds) {
    if (nodeIds.length === 0) return new Map();
    const rows = await db
      .selectFrom("branch_markers")
      .select(["child_node_id as node_id", "id as version"])
      .where("child_node_id", "in", nodeIds)
      .execute();
    return toMap(rows);
  },
};

export const READERS: Record<SourcePart, SourceReader> = { summary, conversation, anchor };
