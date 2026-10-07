import { sql } from "kysely";
import type { Selectable } from "kysely";
import { db, type DB, type Trx } from "../db/client";
import type { ParkedTangent } from "@/shared/schemas";
import type { ParkedTangentsTable } from "../db/schema";
import { ConflictError, NotFoundError } from "../errors";

// The only place that derives a parked tangent's state from its events (data-model.md).

export type ParkedRow = Selectable<ParkedTangentsTable>;

export function toParkedTangent(t: ParkedRow, question: string | null): ParkedTangent {
  return {
    id: t.id,
    nodeId: t.node_id,
    anchor: { start: t.start_offset, end: t.end_offset, text: t.anchor_text, prefix: t.prefix, suffix: t.suffix },
    question,
    createdAt: t.created_at.toISOString(),
  };
}

/** Blank or whitespace-only input means "no question"; anything else is kept exactly as typed. */
export function normalizeQuestion(q: string | null | undefined): string | null {
  return q == null || q.trim() === "" ? null : q;
}

const consumed = () => new ConflictError("parked_consumed", "This parked item was already used or discarded");

/** Locks a tangent for the rest of the transaction and checks it is still live. */
export async function lockTangent(trx: Trx, id: string): Promise<ParkedRow> {
  const row = await trx.selectFrom("parked_tangents").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  if (!row) throw new NotFoundError("Parked item not found");
  const ended = await trx
    .selectFrom("parked_tangent_events")
    .select("id")
    .where("tangent_id", "=", id)
    .where("kind", "in", ["discarded", "fired"])
    .executeTakeFirst();
  if (ended) throw consumed();
  return row;
}

/** Maps a second terminal event (a race that slipped past the lock) to `parked_consumed`. */
export function asConsumed(err: unknown): never {
  if (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "23505" &&
    (err as { constraint?: string }).constraint === "parked_events_terminal"
  ) {
    throw consumed();
  }
  throw err;
}

export async function currentQuestion(q: DB | Trx, id: string): Promise<string | null> {
  const row = await q
    .selectFrom("parked_tangent_events")
    .select("question")
    .where("tangent_id", "=", id)
    .where("kind", "=", "question_set")
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  return row?.question ?? null;
}

/** An element's live tangents, newest first, each with its current question (Feature 8, FR-022). */
export async function liveParked(nodeId: string, q: DB | Trx = db): Promise<Array<ParkedRow & { question: string | null }>> {
  const { rows } = await sql<ParkedRow & { question: string | null }>`
    SELECT t.*, q.question
    FROM parked_tangents t
    LEFT JOIN LATERAL (
      SELECT e.question FROM parked_tangent_events e
      WHERE e.tangent_id = t.id AND e.kind = 'question_set'
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT 1
    ) q ON true
    WHERE t.node_id = ${nodeId}
      AND NOT EXISTS (
        SELECT 1 FROM parked_tangent_events e
        WHERE e.tangent_id = t.id AND e.kind IN ('discarded', 'fired')
      )
    ORDER BY t.created_at DESC, t.id DESC
  `.execute(q);
  return rows;
}
