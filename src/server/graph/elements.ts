// Graph elements (research R1, R5; data-model.md): inserting them with their kind's shape,
// mapping rows to the API's Element, deriving edge state, and loading them from live projects.
import { type Selectable, sql } from "kysely";
import { getKind } from "@/shared/kinds";
import type { EdgeState, Element, ElementOrigin, Provenance, Review, Span } from "@/shared/schemas";
import type { DB, Trx } from "../db/client";
import type { AnswerStatus, NodesTable } from "../db/schema";
import { InvalidRequestError, NotFoundError } from "../errors";
import { findFunction } from "../functions/definitions";

export type ElementRow = Selectable<NodesTable>;
type Q = DB | Trx;

const iso = (d: Date) => d.toISOString();

/** Checks properties against the kind's declaration; undeclared keys fail (FR-054). */
export function validateProperties(kind: string, props: Record<string, unknown>): Record<string, unknown> {
  const result = getKind(kind).properties.safeParse(props);
  if (!result.success) throw new InvalidRequestError(`Undeclared or invalid property for a ${kind} element`);
  return result.data as Record<string, unknown>;
}

export type NewElement = {
  id?: string;
  kind: string;
  parentId: string | null;
  treeId: string;
  projectId: string;
  origin: ElementOrigin;
  provenance: Provenance;
  text?: string | null;
  status?: AnswerStatus | null;
  pressureLevel?: number | null;
  replyModel?: string | null;
  anchor?: Span | null;
  requeryOf?: string | null;
  functionId?: string | null;
  functionVersion?: number | null;
  properties?: Record<string, unknown>;
  sentAt?: Date | null;
};

/** Inserts one element. Its shape comes from the kind declaration (FR-043). */
export async function insertElement(q: Q, e: NewElement): Promise<ElementRow> {
  const kind = getKind(e.kind);
  const properties = validateProperties(e.kind, e.properties ?? {});
  return q
    .insertInto("nodes")
    .values({
      ...(e.id ? { id: e.id } : {}),
      project_id: e.projectId,
      tree_id: e.treeId,
      parent_id: e.parentId,
      kind: kind.id,
      shape: kind.shape,
      origin: e.origin,
      provenance: e.provenance,
      text: e.text ?? null,
      status: e.status ?? null,
      pressure_level: e.pressureLevel ?? null,
      reply_model: e.replyModel ?? null,
      anchor_start: e.anchor?.start ?? null,
      anchor_end: e.anchor?.end ?? null,
      anchor_text: e.anchor?.text ?? null,
      anchor_prefix: e.anchor?.prefix ?? null,
      anchor_suffix: e.anchor?.suffix ?? null,
      requery_of: e.requeryOf ?? null,
      function_id: e.functionId ?? null,
      function_version: e.functionVersion ?? null,
      properties: JSON.stringify(properties),
      sent_at: e.sentAt ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** Edge state (FR-006, research R5): derived from the text and the newest attempt. */
export function edgeState(edge: Pick<ElementRow, "text">, newestAttempt: Pick<ElementRow, "status"> | null | undefined): EdgeState {
  if (edge.text === null) return "unsent";
  switch (newestAttempt?.status) {
    case "pending":
      return "replying";
    case "complete":
      return "answered";
    case "incomplete":
    case "stopped":
    case "failed":
      return newestAttempt.status;
    default:
      // Sent with no attempt: storing the pending answer failed.
      return "failed";
  }
}

/** A function edge's review, from its outputs' (data-model.md "Output review"). */
export function edgeReview(outputReviews: Review[]): Review {
  if (outputReviews.length > 0 && outputReviews.every((r) => r === "rejected")) return "rejected";
  if (outputReviews.some((r) => r === "confirmed")) return "confirmed";
  return "proposed";
}

export function anchorOf(row: ElementRow): Span | null {
  if (row.anchor_start === null || row.anchor_end === null || row.anchor_text === null) return null;
  return {
    start: row.anchor_start,
    end: row.anchor_end,
    text: row.anchor_text,
    prefix: row.anchor_prefix ?? "",
    suffix: row.anchor_suffix ?? "",
  };
}

export type ElementExtras = {
  /** Question edges: the newest attempt, for the derived state. */
  newestAttempt?: Pick<ElementRow, "status"> | null;
  /** Question edges: the current note. */
  note?: string | null;
  /** Outputs: newest review; function edges: derived from their outputs. */
  review?: Review;
};

export function toElement(row: ElementRow, extras: ElementExtras = {}): Element {
  const el: Element = {
    id: row.id,
    treeId: row.tree_id,
    parentId: row.parent_id,
    kind: row.kind,
    shape: row.shape,
    origin: row.origin,
    provenance: row.provenance,
    text: row.text,
    createdAt: iso(row.created_at),
    manual: row.manual_x !== null && row.manual_y !== null ? { x: row.manual_x, y: row.manual_y } : null,
  };
  if (row.kind === "question") {
    el.state = edgeState(row, extras.newestAttempt);
    el.anchor = anchorOf(row);
    el.requeryOf = row.requery_of;
    el.note = extras.note ?? null;
    el.sentAt = row.sent_at ? iso(row.sent_at) : null;
  }
  if (row.status !== null) {
    el.status = row.status;
    el.partialText = row.partial_text;
    el.pressureLevel = row.pressure_level;
    el.replyModel = row.reply_model;
  }
  if (row.function_id !== null && row.function_version !== null) {
    el.functionId = row.function_id;
    el.functionName = findFunction(row.function_id)?.name ?? row.function_id;
    el.functionVersion = row.function_version;
    el.review = extras.review ?? "proposed";
  }
  return el;
}

/** An element row in a live (untrashed) project; 404 otherwise (FR-059). */
export async function loadLive(q: Q, id: string): Promise<ElementRow> {
  const row = await q
    .selectFrom("nodes")
    .innerJoin("projects", "projects.id", "nodes.project_id")
    .selectAll("nodes")
    .where("nodes.id", "=", id)
    .where("projects.trashed_at", "is", null)
    .executeTakeFirst();
  if (!row) throw new NotFoundError("Element not found");
  return row;
}

/** Locks an element's row for the rest of the transaction. */
export async function lockElement(trx: Trx, id: string): Promise<ElementRow> {
  const row = await trx.selectFrom("nodes").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  if (!row) throw new NotFoundError("Element not found");
  return row;
}

/** The newest answer under an edge, by creation time then id. */
export async function newestAttempt(q: Q, edgeId: string): Promise<ElementRow | undefined> {
  return q
    .selectFrom("nodes")
    .selectAll()
    .where("parent_id", "=", edgeId)
    .where("kind", "=", "answer")
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
}

/** The current note on an edge (FR-040). */
export async function currentNote(q: Q, edgeId: string): Promise<string | null> {
  const row = await q
    .selectFrom("edge_notes")
    .select("text")
    .where("edge_id", "=", edgeId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  return row?.text ?? null;
}

/** The newest review of an output; `proposed` when there is none. */
export async function outputReview(q: Q, outputId: string): Promise<Review> {
  const row = await q
    .selectFrom("output_reviews")
    .select("kind")
    .where("node_id", "=", outputId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  return row?.kind ?? "proposed";
}

/** One element as the API returns it, with its derived extras. */
export async function loadElement(q: Q, id: string): Promise<Element> {
  const row = await loadLive(q, id);
  return toElementWithExtras(q, row);
}

export async function toElementWithExtras(q: Q, row: ElementRow): Promise<Element> {
  if (row.kind === "question") {
    const [attempt, note] = await Promise.all([newestAttempt(q, row.id), currentNote(q, row.id)]);
    return toElement(row, { newestAttempt: attempt ?? null, note });
  }
  if (row.origin === "run" && row.shape === "node") return toElement(row, { review: await outputReview(q, row.id) });
  if (row.origin === "run") {
    const { rows } = await sql<{ kind: Review | null }>`
      SELECT (SELECT r.kind FROM output_reviews r WHERE r.node_id = o.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS kind
      FROM nodes o WHERE o.parent_id = ${row.id}`.execute(q);
    return toElement(row, { review: edgeReview(rows.map((r) => r.kind ?? "proposed")) });
  }
  return toElement(row);
}
