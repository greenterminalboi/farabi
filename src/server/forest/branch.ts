import type { Selectable } from "kysely";
import type { Anchor, BranchResponse } from "@/shared/schemas";
import { db, type Trx } from "../db/client";
import type { MessagesTable, NodesTable } from "../db/schema";
import { ConflictError, InvalidSelectionError, NotFoundError } from "../errors";
import { assertId } from "../ids";
import { toMapNode, toMarker } from "../mappers";
import { placeholderFor } from "../summaries/placeholder";

type AnchorSpan = Pick<Anchor, "messageId" | "start" | "end" | "text">;

/**
 * Checks that a selection can anchor a branch from `parentNodeId`: the message belongs to it, is
 * complete and live, and the offsets and text match (FR-002, FR-008). Shared by Branch and Park.
 */
export async function validateAnchor(trx: Trx, parentNodeId: string, anchor: AnchorSpan) {
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
  return { parent, message };
}

/** Inserts the child node and its selection marker for a validated anchor. */
export async function insertBranch(
  trx: Trx,
  parent: Selectable<NodesTable>,
  message: Selectable<MessagesTable>,
  { start, end, text }: AnchorSpan,
) {
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
  return { child, marker };
}

/**
 * Creates a branch from a selection in one of the parent's messages (FR-002–FR-004, FR-008).
 * Structure is user-authored; the AI is never called here (FR-004, Article IV).
 */
export async function createBranch(parentNodeId: string, anchor: Anchor): Promise<BranchResponse> {
  assertId(parentNodeId, "Node");
  assertId(anchor.messageId, "Message");

  return db.transaction().execute(async (trx) => {
    const { parent, message } = await validateAnchor(trx, parentNodeId, anchor);
    const { child, marker } = await insertBranch(trx, parent, message, anchor);
    return { node: toMapNode(child, anchor.text, placeholderFor(anchor.text)), marker: toMarker(marker) };
  });
}
