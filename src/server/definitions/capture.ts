import { termKey } from "@/shared/termKey";
import type { Definition } from "@/shared/schemas";
import { db } from "../db/client";
import { ConflictError, InvalidSelectionError, NotFoundError } from "../errors";
import { assertId } from "../ids";
import { enqueueDraft } from "./draftQueue";
import { getDefinition } from "./list";

const MAX_TERM = 120;

/**
 * Captures a highlighted term (FR-027). A term that already has an entry (same key) returns that
 * entry and creates nothing (FR-034); a new one starts an AI draft (FR-028).
 */
export async function captureDefinition(input: {
  nodeId: string;
  messageId: string;
  start: number;
  end: number;
  text: string;
}): Promise<{ definition: Definition; created: boolean }> {
  assertId(input.nodeId, "Node");
  assertId(input.messageId, "Message");
  const message = await db.selectFrom("messages").selectAll().where("id", "=", input.messageId).executeTakeFirst();
  if (!message || message.node_id !== input.nodeId) {
    throw new InvalidSelectionError("The selection must be inside a message of this conversation");
  }
  if (message.status !== "complete" || message.replaced_at !== null) {
    throw new ConflictError("message_not_branchable", "Terms can only be taken from completed messages");
  }
  const { start, end, text } = input;
  if (!(start >= 0 && start < end && end <= message.content.length) || message.content.slice(start, end) !== text) {
    throw new InvalidSelectionError("The selected text doesn't match the message");
  }
  const term = text.trim().replace(/\s+/g, " ");
  if (!term) throw new InvalidSelectionError("The selection is empty");
  if (term.length > MAX_TERM) throw new InvalidSelectionError(`Terms are limited to ${MAX_TERM} characters`);

  // A term belongs to the project of the conversation it came from (Feature 4, plan D4).
  const { project_id: projectId } = await db
    .selectFrom("nodes")
    .innerJoin("trees", "trees.id", "nodes.tree_id")
    .select("trees.project_id")
    .where("nodes.id", "=", input.nodeId)
    .executeTakeFirstOrThrow();
  const inserted = await db
    .insertInto("definitions")
    .values({
      project_id: projectId,
      term,
      term_key: termKey(term),
      source_node_id: input.nodeId,
      source_message_id: input.messageId,
    })
    .onConflict((oc) => oc.columns(["project_id", "term_key"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  if (inserted) {
    enqueueDraft(inserted.id);
    return { definition: (await getDefinition(inserted.id)).definition, created: true };
  }
  const existing = await db
    .selectFrom("definitions")
    .select("id")
    .where("project_id", "=", projectId)
    .where("term_key", "=", termKey(term))
    .executeTakeFirst();
  if (!existing) throw new NotFoundError("Definition not found");
  return { definition: (await getDefinition(existing.id)).definition, created: false };
}
