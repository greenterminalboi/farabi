// Asking (FR-010–FR-015, FR-020): start a tree, ask from an element, send an unsent edge. Each
// stores the question edge and a pending answer in one transaction and starts the reply after
// commit; the reply streams separately (Feature 2).
import { sql } from "kysely";
import { findKind } from "@/shared/kinds";
import type { AskResponse, Element, SendResponse, StartTreeResponse } from "@/shared/schemas";
import { insertPendingAnswer, startGeneration } from "../answers/generation";
import { db, type Trx } from "../db/client";
import { ConflictError, InvalidRequestError, NotFoundError } from "../errors";
import { assertId } from "../ids";
import { toTree } from "./canvas";
import { buildReplyInput } from "./context";
import { type ElementRow, insertElement, lockElement, newestAttempt, toElement } from "./elements";
import { QUICK_BRANCH, tryQuickBranch } from "./quickBranch";

/** Horizontal distance between new trees' origins; the forest layout resolves any overlap. */
const TREE_SPACING = 2000;

/** Starts the reply for a pending answer; resolves when it ends. */
export function generate(answerId: string): Promise<Element> {
  return startGeneration(answerId, () => buildReplyInput(answerId));
}

function assertContent(content: string): void {
  if (content.trim() === "") throw new InvalidRequestError("Message must not be empty");
}

/** Refuses elements in trashed projects (FR-059). */
async function assertLiveProject(trx: Trx, projectId: string): Promise<void> {
  const live = await trx
    .selectFrom("projects")
    .select("id")
    .where("id", "=", projectId)
    .where("trashed_at", "is", null)
    .executeTakeFirst();
  if (!live) throw new NotFoundError("Project not found");
}

/** A new tree: an origin edge with the user's text and a pending answer (FR-005, FR-014). */
export async function startTree(projectId: string, content: string): Promise<StartTreeResponse> {
  assertId(projectId, "Project");
  assertContent(content);
  const created = await db.transaction().execute(async (trx) => {
    await assertLiveProject(trx, projectId);
    // Serialize origin allocation between concurrent starts; each project's canvas starts at x = 0.
    await sql`SELECT pg_advisory_xact_lock(hashtext('farabi:tree-origin'))`.execute(trx);
    const { maxX } = await trx
      .selectFrom("trees")
      .select((eb) => eb.fn.max("layout_origin_x").as("maxX"))
      .where("project_id", "=", projectId)
      .executeTakeFirstOrThrow();
    const x = (maxX === null ? -TREE_SPACING : Number(maxX)) + TREE_SPACING;
    const tree = await trx
      .insertInto("trees")
      .values({ project_id: projectId, layout_origin_x: x, layout_origin_y: 0 })
      .returningAll()
      .executeTakeFirstOrThrow();
    const edge = await insertElement(trx, {
      kind: "question",
      parentId: null,
      treeId: tree.id,
      projectId,
      origin: "origin",
      provenance: "user_authored",
      text: content,
      sentAt: new Date(),
    });
    const answer = await insertPendingAnswer(trx, edge, "reply");
    return { tree, edge, answer };
  });
  void generate(created.answer.id);
  return {
    tree: toTree(created.tree, created.answer.id),
    edge: toElement(created.edge, { newestAttempt: created.answer }),
    answer: toElement(created.answer),
  };
}

/** Inserts a sent question edge under `parent` and its pending answer, inside `trx`. */
export async function insertAsk(
  trx: Trx,
  parent: Pick<ElementRow, "id" | "tree_id" | "project_id">,
  content: string,
  extra: { origin?: "ask" | "quick_branch"; requeryOf?: string } = {},
): Promise<{ edge: ElementRow; answer: ElementRow }> {
  const edge = await insertElement(trx, {
    kind: "question",
    parentId: parent.id,
    treeId: parent.tree_id,
    projectId: parent.project_id,
    origin: extra.origin ?? "ask",
    provenance: "user_authored",
    text: content,
    requeryOf: extra.requeryOf ?? null,
    sentAt: new Date(),
  });
  const answer = await insertPendingAnswer(trx, edge, "reply");
  return { edge, answer };
}

/**
 * Checks that a new question can leave `el` (data-model.md "Ask"): an answer that isn't pending
 * and has text, or a sent question edge whose newest attempt isn't pending ("two user messages in
 * a row"). Function edges and outputs are never asked from (outputs are leaves, R12). Other content
 * kinds that give an AI turn (Feature 12's drill problems and verdicts) are asked from like answers.
 */
export async function assertAskable(trx: Trx, el: ElementRow): Promise<void> {
  const aiTurn = el.kind !== "answer" && el.shape === "node" && el.text !== null && findKind(el.kind)?.contextRole === "ai";
  if (aiTurn) return;
  if (el.kind === "answer") {
    if (el.status === "pending") throw new ConflictError("reply_in_progress", "Wait for the current reply to finish");
    if (el.status === "failed") throw new ConflictError("not_askable", "This reply failed; retry it or ask from its message");
    return;
  }
  if (el.kind === "question") {
    if (el.text === null) throw new ConflictError("not_askable", "Send this message first");
    const attempt = await newestAttempt(trx, el.id);
    if (attempt?.status === "pending") throw new ConflictError("reply_in_progress", "Wait for the current reply to finish");
    return;
  }
  throw new ConflictError("not_askable", "You can't ask from this element");
}

/**
 * The composer's send (FR-010, FR-013): a new question edge from `elementId` and a pending answer.
 * Asking again from the same element adds a sibling edge; nothing existing changes. An exact
 * "????" from an answer is a quick branch when one is possible (FR-020).
 */
export async function ask(elementId: string, content: string): Promise<AskResponse> {
  assertId(elementId, "Element");
  assertContent(content);
  if (content.trim() === QUICK_BRANCH) {
    const branched = await tryQuickBranch(elementId);
    if (branched) return branched;
  }
  const created = await db.transaction().execute(async (trx) => {
    const el = await lockElement(trx, elementId);
    await assertLiveProject(trx, el.project_id);
    await assertAskable(trx, el);
    return insertAsk(trx, el, content);
  });
  void generate(created.answer.id);
  return {
    kind: "message",
    edge: toElement(created.edge, { newestAttempt: created.answer }),
    answer: toElement(created.answer),
  };
}

/** Sends an unsent edge once (a branch or a parked tangent fired without a question). */
export async function sendUnsent(edgeId: string, content: string): Promise<SendResponse> {
  assertId(edgeId, "Edge");
  assertContent(content);
  const created = await db.transaction().execute(async (trx) => {
    const edge = await lockElement(trx, edgeId);
    await assertLiveProject(trx, edge.project_id);
    if (edge.kind !== "question") throw new ConflictError("not_an_edge", "Only a message can be sent");
    if (edge.text !== null) throw new ConflictError("already_sent", "This message was already sent");
    const sent = await trx
      .updateTable("nodes")
      .set({ text: content, sent_at: new Date() })
      .where("id", "=", edgeId)
      .returningAll()
      .executeTakeFirstOrThrow();
    const answer = await insertPendingAnswer(trx, sent, "reply");
    return { edge: sent, answer };
  });
  void generate(created.answer.id);
  return { edge: toElement(created.edge, { newestAttempt: created.answer }), answer: toElement(created.answer) };
}
