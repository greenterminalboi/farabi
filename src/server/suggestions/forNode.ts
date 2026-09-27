import type { SuggestedSpan, SuggestionsResponse } from "@/shared/schemas";
import { SPAN_DETECTOR_VERSION } from "../ai/claudePrompts";
import { db } from "../db/client";
import { NotFoundError } from "../errors";
import { assertId } from "../ids";
import { enqueueSuggestions, inCooldown, waitForSuggestions } from "./queue";

const WAIT_MS = 5000;

async function cached(messageIds: string[]): Promise<Map<string, SuggestedSpan[]>> {
  if (messageIds.length === 0) return new Map();
  const rows = await db
    .selectFrom("span_suggestions")
    .select(["message_id", "spans"])
    .where("message_id", "in", messageIds)
    .where("detector_version", "=", SPAN_DETECTOR_VERSION)
    .execute();
  return new Map(rows.map((r) => [r.message_id, r.spans]));
}

/**
 * Suggestions for a node's live, complete AI messages (contracts/http-api.md). Queues the ones not
 * yet analyzed and waits briefly for them. Reads messages and the cache; writes only the cache,
 * through the queue (FR-006, SC-004).
 */
export async function suggestionsForNode(nodeId: string): Promise<SuggestionsResponse> {
  assertId(nodeId, "Node");
  const node = await db.selectFrom("nodes").select("id").where("id", "=", nodeId).executeTakeFirst();
  if (!node) throw new NotFoundError("Node not found");

  // Only complete AI replies get suggestions (FR-003, FR-007); newest first.
  const ids = (
    await db
      .selectFrom("messages")
      .select("id")
      .where("node_id", "=", nodeId)
      .where("role", "=", "ai")
      .where("status", "=", "complete")
      .where("replaced_at", "is", null)
      .orderBy("seq", "desc")
      .execute()
  ).map((m) => m.id);

  let found = await cached(ids);
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    enqueueSuggestions(missing);
    await waitForSuggestions(missing, WAIT_MS);
    found = await cached(ids);
  }
  return {
    byMessage: Object.fromEntries(found),
    pending: ids.filter((id) => !found.has(id) && !inCooldown(id)),
  };
}
