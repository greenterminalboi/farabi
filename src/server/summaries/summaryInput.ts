import type { SummaryInput } from "../ai/provider";
import { db } from "../db/client";

/**
 * Input for a node's summary: that node's own live, complete messages and its own anchor text.
 * Deliberately never reads inherited parent context (FR-012, contracts/ai-provider.md).
 */
export async function buildSummaryInput(
  nodeId: string,
): Promise<{ input: SummaryInput; throughMessageId: string | null }> {
  const [messages, incoming] = await Promise.all([
    db
      .selectFrom("messages")
      .select(["id", "role", "content"])
      .where("node_id", "=", nodeId)
      .where("replaced_at", "is", null)
      .where("status", "=", "complete")
      .orderBy("seq", "asc")
      .execute(),
    db
      .selectFrom("branch_markers")
      .select("anchor_text")
      .where("child_node_id", "=", nodeId)
      .executeTakeFirst(),
  ]);
  return {
    input: {
      anchorText: incoming?.anchor_text ?? null,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    },
    throughMessageId: messages.at(-1)?.id ?? null,
  };
}
