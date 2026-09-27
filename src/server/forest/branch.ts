import type { Anchor, BranchResponse } from "@/shared/schemas";
import { db } from "../db/client";
import { ConflictError, InvalidSelectionError, NotFoundError } from "../errors";
import { assertId } from "../ids";
import { toMapNode, toMarker } from "../mappers";
import { placeholderFor } from "../summaries/placeholder";

/**
 * Creates a branch from a selection in one of the parent's messages (FR-002–FR-004, FR-008).
 * Structure is user-authored; the AI is never called here (FR-004, Article IV).
 */
export async function createBranch(parentNodeId: string, anchor: Anchor): Promise<BranchResponse> {
  assertId(parentNodeId, "Node");
  assertId(anchor.messageId, "Message");

  return db.transaction().execute(async (trx) => {
    const parent = await trx
      .selectFrom("nodes")
      .selectAll()
      .where("id", "=", parentNodeId)
      .executeTakeFirst();
    if (!parent) throw new NotFoundError("Node not found");

    const message = await trx
      .selectFrom("messages")
      .selectAll()
      .where("id", "=", anchor.messageId)
      .executeTakeFirst();
    if (!message || message.node_id !== parentNodeId) {
      throw new InvalidSelectionError("The selection must be inside a message of this conversation");
    }
    if (message.status !== "complete" || message.replaced_at !== null) {
      throw new ConflictError("message_not_branchable", "This message can't be branched from");
    }

    const { start, end, text } = anchor;
    if (!(start >= 0 && start < end && end <= message.content.length)) {
      throw new InvalidSelectionError("The selection is outside the message");
    }
    if (text.trim() === "") throw new InvalidSelectionError("The selection is empty");
    if (message.content.slice(start, end) !== text) {
      throw new InvalidSelectionError("The selected text doesn't match the message");
    }

    const child = await trx
      .insertInto("nodes")
      .values({ tree_id: parent.tree_id, parent_id: parent.id, provenance: "user_authored" })
      .returningAll()
      .executeTakeFirstOrThrow();
    const marker = await trx
      .insertInto("branch_markers")
      .values({
        parent_node_id: parent.id,
        message_id: message.id,
        child_node_id: child.id,
        start_offset: start,
        end_offset: end,
        anchor_text: text,
        prefix: message.content.slice(Math.max(0, start - 32), start),
        suffix: message.content.slice(end, end + 32),
        provenance: "user_authored",
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return { node: toMapNode(child, text, placeholderFor(text)), marker: toMarker(marker) };
  });
}
