import type { ChatTurn, ReplyInput } from "../ai/provider";
import { getInheritedContext } from "../forest/inheritedContext";
import { getIncomingMarker, liveMessages } from "../forest/nodeView";

/** Context for the AI's next reply in a node: inherited parent context + anchor + own messages. */
export async function buildReplyInput(
  nodeId: string,
  options: { excludeMessageId?: string } = {},
): Promise<ReplyInput> {
  const [inherited, incoming, own] = await Promise.all([
    getInheritedContext(nodeId),
    getIncomingMarker(nodeId),
    liveMessages(nodeId),
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
  };
}
