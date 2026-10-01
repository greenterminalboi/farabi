import type { Selectable } from "kysely";
import { getKind } from "@/shared/kinds";
import { db } from "../db/client";
import type { NodesTable } from "../db/schema";
import { ConflictError, InvalidRequestError, NotFoundError } from "../errors";

type KindOf = Pick<Selectable<NodesTable>, "kind">;

/**
 * Refuses conversation-only actions (messages, Branch, Define, Park, summaries) on nodes of a
 * kind that isn't backed by a conversation (Feature 9, FR-005).
 */
export function assertConversation(node: KindOf): void {
  const kind = getKind(node.kind);
  if (!kind.conversationBacked) {
    throw new ConflictError("wrong_kind", `This is ${article(kind.label)} ${kind.label.toLowerCase()}, not a conversation`, {
      kind: node.kind,
    });
  }
}

/** Loads a node's kind and refuses if it isn't backed by a conversation. */
export async function assertConversationNode(nodeId: string): Promise<void> {
  const node = await db.selectFrom("nodes").select("kind").where("id", "=", nodeId).executeTakeFirst();
  if (!node) throw new NotFoundError("Node not found");
  assertConversation(node);
}

/** A conversation with a parent: the only kind of node with an incoming edge. */
export function isConversationChild(node: Pick<Selectable<NodesTable>, "kind" | "parent_id">): boolean {
  return node.kind === "conversation" && node.parent_id !== null;
}

/** Checks a node's properties against its kind's declaration; undeclared keys fail (FR-035). */
export function validateProperties(kind: string, props: Record<string, unknown>): Record<string, unknown> {
  const result = getKind(kind).properties.safeParse(props);
  if (!result.success) throw new InvalidRequestError(`Undeclared or invalid property for a ${kind} node`);
  return result.data as Record<string, unknown>;
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");
