// Hand placement (FR-037, FR-038). Presentation only: positions never touch structure, and the
// guard trigger only lets manual_x/y change.
import type { Camera, Element, Tree } from "@/shared/schemas";
import { db } from "../db/client";
import { ConflictError, NotFoundError } from "../errors";
import { assertId } from "../ids";
import { toCamera, toTree } from "./canvas";
import { loadLive, toElementWithExtras } from "./elements";

/** Places one element relative to its tree's origin. The origin edge moves with its tree instead. */
export async function setPosition(elementId: string, x: number, y: number): Promise<Element> {
  assertId(elementId, "Element");
  return db.transaction().execute(async (trx) => {
    const el = await loadLive(trx, elementId);
    if (el.parent_id === null) throw new ConflictError("origin_edge", "Move the tree instead");
    const row = await trx
      .updateTable("nodes")
      .set({ manual_x: x, manual_y: y })
      .where("id", "=", elementId)
      .returningAll()
      .executeTakeFirstOrThrow();
    return toElementWithExtras(trx, row);
  });
}

/**
 * Moves a tree. A drag by the user marks it placed, and it is then never moved automatically
 * (FR-038); the client also persists its own overlap relocations with `byUser: false`.
 */
export async function setTreeOrigin(treeId: string, x: number, y: number, byUser = true): Promise<Tree> {
  assertId(treeId, "Tree");
  const tree = await db
    .updateTable("trees")
    .set(byUser ? { layout_origin_x: x, layout_origin_y: y, user_placed: true } : { layout_origin_x: x, layout_origin_y: y })
    .where("id", "=", treeId)
    .where("project_id", "in", (eb) => eb.selectFrom("projects").select("id").where("trashed_at", "is", null))
    .returningAll()
    .executeTakeFirst();
  if (!tree) throw new NotFoundError("Tree not found");
  const root = await db
    .selectFrom("nodes as a")
    .innerJoin("nodes as e", "e.id", "a.parent_id")
    .select("a.id")
    .where("e.tree_id", "=", treeId)
    .where("e.parent_id", "is", null)
    .where("a.kind", "=", "answer")
    .orderBy("a.created_at")
    .orderBy("a.id")
    .limit(1)
    .executeTakeFirst();
  return toTree(tree, root?.id ?? null);
}

/** Saves a project's camera, after it has been idle (FR-028). */
export async function saveCamera(projectId: string, camera: Camera): Promise<Camera> {
  assertId(projectId, "Project");
  const live = await db
    .selectFrom("projects")
    .select("id")
    .where("id", "=", projectId)
    .where("trashed_at", "is", null)
    .executeTakeFirst();
  if (!live) throw new NotFoundError("Project not found");
  const row = await db
    .insertInto("project_cameras")
    .values({ project_id: projectId, x: camera.x, y: camera.y, scale: camera.scale })
    .onConflict((oc) =>
      oc.column("project_id").doUpdateSet({ x: camera.x, y: camera.y, scale: camera.scale, updated_at: new Date() }),
    )
    .returningAll()
    .executeTakeFirstOrThrow();
  return toCamera(row);
}
