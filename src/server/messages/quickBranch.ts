import type { SendMessageResponse } from "@/shared/schemas";
import { db } from "../db/client";
import { toMapNode, toMarker } from "../mappers";
import { placeholderFor } from "../summaries/placeholder";
import { sendMessage } from "./send";

export const QUICK_BRANCH = "????";

/**
 * "????" (FR-006–FR-012): branch the current node from the user's most recent message and send
 * that text again as the new branch's first message. Returns null when there is nothing (new) to
 * branch from, so the caller treats "????" as an ordinary message.
 */
export async function tryQuickBranch(
  nodeId: string,
): Promise<Extract<SendMessageResponse, { kind: "quick_branch" }> | null> {
  const created = await db.transaction().execute(async (trx) => {
    const parent = await trx.selectFrom("nodes").selectAll().where("id", "=", nodeId).forUpdate().executeTakeFirst();
    if (!parent) return null;
    const anchor = await trx
      .selectFrom("messages")
      .selectAll()
      .where("node_id", "=", nodeId)
      .where("role", "=", "user")
      .where("status", "=", "complete")
      .where("replaced_at", "is", null)
      .orderBy("seq", "desc")
      .limit(1)
      .executeTakeFirst();
    if (!anchor) return null;
    const used = await trx
      .selectFrom("branch_markers")
      .select("id")
      .where("message_id", "=", anchor.id)
      .where("kind", "=", "whole_message")
      .executeTakeFirst();
    if (used) return null;

    const child = await trx
      .insertInto("nodes")
      .values({ tree_id: parent.tree_id, parent_id: parent.id, provenance: "user_authored" })
      .returningAll()
      .executeTakeFirstOrThrow();
    const marker = await trx
      .insertInto("branch_markers")
      .values({
        parent_node_id: parent.id,
        message_id: anchor.id,
        child_node_id: child.id,
        start_offset: 0,
        end_offset: anchor.content.length,
        anchor_text: anchor.content,
        prefix: "",
        suffix: "",
        kind: "whole_message",
        provenance: "user_authored",
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { child, marker, text: anchor.content };
  });
  if (!created) return null;

  const sent = await sendMessage(created.child.id, created.text);
  return {
    kind: "quick_branch",
    node: toMapNode(created.child, created.text, placeholderFor(created.text)),
    marker: toMarker(created.marker),
    userMessage: sent.userMessage,
    aiMessage: sent.aiMessage,
  };
}
