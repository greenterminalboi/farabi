// The canvas of one project (research R13): every element with full text, trees, the current
// note of each edge, review state and the saved camera, in a handful of set-based queries.
import type { CanvasResponse, Review, Tree } from "@/shared/schemas";
import { finalizeOrphan, isGenerating } from "../answers/generation";
import { db } from "../db/client";
import type { ProjectCamerasTable, TreesTable } from "../db/schema";
import { NotFoundError } from "../errors";
import { type ElementRow, edgeReview, toElement } from "./elements";
import type { Selectable } from "kysely";

export function toTree(t: Selectable<TreesTable>, rootAnswerId: string | null): Tree {
  return {
    id: t.id,
    origin: { x: t.layout_origin_x, y: t.layout_origin_y },
    userPlaced: t.user_placed,
    rootAnswerId,
  };
}

export function toCamera(c: Selectable<ProjectCamerasTable>) {
  return { x: c.x, y: c.y, scale: c.scale };
}

const newer = (a: ElementRow, b: ElementRow) =>
  a.created_at.getTime() !== b.created_at.getTime() ? a.created_at > b.created_at : a.id > b.id;

export async function getCanvas(projectId: string): Promise<CanvasResponse> {
  const project = await db
    .selectFrom("projects")
    .select("id")
    .where("id", "=", projectId)
    .where("trashed_at", "is", null)
    .executeTakeFirst();
  if (!project) throw new NotFoundError("Project not found");

  const [trees, rows, notes, reviews, camera] = await Promise.all([
    db.selectFrom("trees").selectAll().where("project_id", "=", projectId).orderBy("created_at").orderBy("id").execute(),
    db
      .selectFrom("nodes")
      .selectAll()
      .where("project_id", "=", projectId)
      .orderBy("created_at")
      .orderBy("id")
      .execute(),
    db
      .selectFrom("edge_notes")
      .innerJoin("nodes", "nodes.id", "edge_notes.edge_id")
      .distinctOn("edge_notes.edge_id")
      .select(["edge_notes.edge_id", "edge_notes.text"])
      .where("nodes.project_id", "=", projectId)
      .orderBy("edge_notes.edge_id")
      .orderBy("edge_notes.created_at", "desc")
      .orderBy("edge_notes.id", "desc")
      .execute(),
    db
      .selectFrom("output_reviews")
      .innerJoin("nodes", "nodes.id", "output_reviews.node_id")
      .distinctOn("output_reviews.node_id")
      .select(["output_reviews.node_id", "output_reviews.kind"])
      .where("nodes.project_id", "=", projectId)
      .orderBy("output_reviews.node_id")
      .orderBy("output_reviews.created_at", "desc")
      .orderBy("output_reviews.id", "desc")
      .execute(),
    db.selectFrom("project_cameras").selectAll().where("project_id", "=", projectId).executeTakeFirst(),
  ]);

  // A pending answer with no live generator is an orphan of a restart (Feature 2).
  const elements = await Promise.all(
    rows.map((r) => (r.status === "pending" && !isGenerating(r.id) ? finalizeOrphan(r) : r)),
  );

  const noteBy = new Map(notes.map((n) => [n.edge_id, n.text]));
  const reviewBy = new Map<string, Review>(reviews.map((r) => [r.node_id, r.kind]));
  const newestAttempt = new Map<string, ElementRow>();
  const earliestAnswer = new Map<string, ElementRow>();
  const outputsOf = new Map<string, Review[]>();
  for (const el of elements) {
    if (el.parent_id === null) continue;
    if (el.kind === "answer") {
      const n = newestAttempt.get(el.parent_id);
      if (!n || newer(el, n)) newestAttempt.set(el.parent_id, el);
      const e = earliestAnswer.get(el.parent_id);
      if (!e || newer(e, el)) earliestAnswer.set(el.parent_id, el);
    }
    if (el.origin === "run" && el.shape === "node") {
      const list = outputsOf.get(el.parent_id) ?? [];
      list.push(reviewBy.get(el.id) ?? "proposed");
      outputsOf.set(el.parent_id, list);
    }
  }

  const originOf = new Map(elements.filter((e) => e.parent_id === null).map((e) => [e.tree_id, e.id]));
  return {
    trees: trees.map((t) => {
      const origin = originOf.get(t.id);
      return toTree(t, origin ? (earliestAnswer.get(origin)?.id ?? null) : null);
    }),
    elements: elements.map((el) => {
      if (el.kind === "question") {
        return toElement(el, { newestAttempt: newestAttempt.get(el.id) ?? null, note: noteBy.get(el.id) ?? null });
      }
      if (el.origin === "run") {
        const review = el.shape === "node" ? (reviewBy.get(el.id) ?? "proposed") : edgeReview(outputsOf.get(el.id) ?? []);
        return toElement(el, { review });
      }
      return toElement(el);
    }),
    camera: camera ? toCamera(camera) : null,
  };
}
