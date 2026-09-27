// In-process summary queue. Interim mechanism: the trigger timing (after each reply vs. on
// exit-to-map) and the job mechanism are pending research R10 and may replace this module.
import { sql } from "kysely";
import { getAIProvider } from "../ai";
import { AIUnavailableError } from "../ai/provider";
import { db } from "../db/client";
import { buildSummaryInput } from "./summaryInput";

const MAX_CONCURRENT = 2;

type QueueState = { queued: Set<string>; running: Set<string>; rerun: Set<string>; idle: Array<() => void> };
const g = globalThis as unknown as { __farabiSummaryQueue?: QueueState };
g.__farabiSummaryQueue ??= { queued: new Set(), running: new Set(), rerun: new Set(), idle: [] };
const q = g.__farabiSummaryQueue;

async function run(nodeId: string): Promise<void> {
  try {
    const { input, throughMessageId } = await buildSummaryInput(nodeId);
    // A node needs at least one completed AI reply before it gets a summary (FR-011).
    if (!throughMessageId || !input.messages.some((m) => m.role === "ai")) return;
    const text = await getAIProvider().summarize(input);
    await db
      .insertInto("node_summaries")
      .values({
        node_id: nodeId,
        text,
        provenance: "ai_suggested",
        through_message_id: throughMessageId,
      })
      .execute();
  } catch (err) {
    // Keep the previous summary; the next completed reply will try again.
    if (!(err instanceof AIUnavailableError)) console.error("summary failed", nodeId, err);
  }
}

function pump(): void {
  for (const nodeId of q.queued) {
    if (q.running.size >= MAX_CONCURRENT) break;
    if (q.running.has(nodeId)) continue;
    q.queued.delete(nodeId);
    q.running.add(nodeId);
    void run(nodeId).finally(() => {
      q.running.delete(nodeId);
      if (q.rerun.delete(nodeId)) q.queued.add(nodeId);
      pump();
    });
  }
  if (q.queued.size === 0 && q.running.size === 0) {
    for (const resolve of q.idle.splice(0)) resolve();
  }
}

/** Requests a summary refresh. Returns immediately; repeated requests per node coalesce. */
export function enqueueSummary(nodeId: string): void {
  if (q.running.has(nodeId)) q.rerun.add(nodeId);
  else q.queued.add(nodeId);
  queueMicrotask(pump);
}

/** Resolves once no summary work is queued or running (used by tests). */
export function drainSummaries(): Promise<void> {
  if (q.queued.size === 0 && q.running.size === 0) return Promise.resolve();
  return new Promise((resolve) => q.idle.push(resolve));
}

/**
 * Called after every completed AI reply. With SUMMARY_TRIGGER=map, summaries wait until the map
 * is opened instead (saves calls when using a Claude subscription); otherwise refresh now (FR-012).
 */
export function summaryAfterReply(nodeId: string): void {
  if (process.env.SUMMARY_TRIGGER !== "map") enqueueSummary(nodeId);
}

/** Queues every node whose label is older than its latest completed AI reply. Returns how many. */
export async function enqueueStaleSummaries(): Promise<number> {
  const { rows } = await sql<{ node_id: string }>`
    WITH latest_ai AS (
      SELECT DISTINCT ON (node_id) node_id, id
      FROM messages
      WHERE role = 'ai' AND status = 'complete' AND replaced_at IS NULL
      ORDER BY node_id, seq DESC
    ),
    latest_msg AS (
      SELECT DISTINCT ON (node_id) node_id, id
      FROM messages
      WHERE status = 'complete' AND replaced_at IS NULL
      ORDER BY node_id, seq DESC
    ),
    latest_summary AS (
      SELECT DISTINCT ON (node_id) node_id, through_message_id
      FROM node_summaries
      ORDER BY node_id, created_at DESC, id DESC
    )
    SELECT a.node_id
    FROM latest_ai a
    JOIN latest_msg m ON m.node_id = a.node_id
    LEFT JOIN latest_summary s ON s.node_id = a.node_id
    WHERE s.through_message_id IS DISTINCT FROM m.id
  `.execute(db);
  for (const { node_id } of rows) enqueueSummary(node_id);
  return rows.length;
}
