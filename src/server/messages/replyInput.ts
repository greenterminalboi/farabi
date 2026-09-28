import type { ChatTurn, ReplyInput } from "../ai/provider";
import { db } from "../db/client";
import { getInheritedContext } from "../forest/inheritedContext";
import { getIncomingMarker, liveMessages } from "../forest/nodeView";

/**
 * Context for the AI's next reply in a node: inherited parent context + anchor + own messages. The
 * level and model come from the pending reply's own row, never the live settings (Feature 6).
 */
export async function buildReplyInput(
  nodeId: string,
  options: { excludeMessageId?: string; replyMessageId?: string } = {},
): Promise<ReplyInput> {
  const [inherited, incoming, own, reply] = await Promise.all([
    getInheritedContext(nodeId),
    getIncomingMarker(nodeId),
    liveMessages(nodeId),
    options.replyMessageId
      ? db
          .selectFrom("messages")
          .select(["pressure_level", "reply_model"])
          .where("id", "=", options.replyMessageId)
          .executeTakeFirst()
      : undefined,
  ]);
  const toTurn = (m: { role: "user" | "ai"; content: string }): ChatTurn => ({
    role: m.role,
    content: m.content,
  });
  return {
    inheritedContext: inherited.flatMap((entry) => entry.messages.map(toTurn)),
    anchorText: incoming?.anchor_text ?? null,
    messages: own
      .filter((m) => m.status === "complete" && m.id !== options.excludeMessageId)
      .map(toTurn),
    pressureLevel: reply?.pressure_level ?? null,
    model: reply?.reply_model ?? null,
  };
}
