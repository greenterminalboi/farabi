// What the AI is given for a reply (FR-007, research R6): the ancestor path of the answer's
// question edge, from the origin down, and nothing else. Siblings and descendants can't appear
// because the walk only goes up.
import { sql } from "kysely";
import type { ChatTurn, ReplyInput } from "../ai/provider";
import { db, type DB, type Trx } from "../db/client";
import type { AnswerStatus } from "../db/schema";
import { NotFoundError } from "../errors";

type PathRow = {
  id: string;
  kind: string;
  text: string | null;
  status: AnswerStatus | null;
  anchor_text: string | null;
};

/** The element and its ancestors, origin first. */
export async function ancestorPath(id: string, q: DB | Trx = db): Promise<PathRow[]> {
  const { rows } = await sql<PathRow>`
    WITH RECURSIVE path AS (
      SELECT id, parent_id, kind, text, status, anchor_text, 0 AS depth FROM nodes WHERE id = ${id}
      UNION ALL
      SELECT n.id, n.parent_id, n.kind, n.text, n.status, n.anchor_text, p.depth + 1
      FROM nodes n JOIN path p ON n.id = p.parent_id
    )
    SELECT id, kind, text, status, anchor_text FROM path ORDER BY depth DESC`.execute(q);
  return rows;
}

/**
 * Context for a pending answer. A question edge is a user turn; an answer is an AI turn only when
 * complete (v1 dropped unfinished replies too). Function edges and outputs are skipped. The
 * highlighted passage is the nearest anchored edge on the path: the branch this reply belongs to.
 * The level and model come from the answer's own row (Feature 6).
 */
export async function buildReplyInput(answerId: string, q: DB | Trx = db): Promise<ReplyInput> {
  const answer = await q
    .selectFrom("nodes")
    .select(["parent_id", "pressure_level", "reply_model"])
    .where("id", "=", answerId)
    .where("kind", "=", "answer")
    .executeTakeFirst();
  if (!answer?.parent_id) throw new NotFoundError("Answer not found");

  const path = await ancestorPath(answer.parent_id, q);
  const messages: ChatTurn[] = [];
  let anchorText: string | null = null;
  for (const el of path) {
    if (el.kind === "question" && el.text !== null) {
      messages.push({ role: "user", content: el.text });
      if (el.anchor_text !== null) anchorText = el.anchor_text;
    } else if (el.kind === "answer" && el.status === "complete" && el.text !== null) {
      messages.push({ role: "ai", content: el.text });
    }
  }
  return {
    inheritedContext: [],
    anchorText,
    messages,
    pressureLevel: answer.pressure_level,
    model: answer.reply_model,
  };
}
