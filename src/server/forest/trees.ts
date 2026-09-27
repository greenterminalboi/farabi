import { sql } from "kysely";
import type { CreateTreeResponse, MapTree } from "@/shared/schemas";
import { db } from "../db/client";
import { NotFoundError } from "../errors";
import { toMapNode, toTree } from "../mappers";
import { placeholderFor } from "../summaries/placeholder";

const TREE_SPACING = 2000;

/** Starts a new, independent root conversation in a project (FR-001). */
export async function createRootTree(projectId: string): Promise<CreateTreeResponse> {
  return db.transaction().execute(async (trx) => {
    // Serialize origin allocation between concurrent creates.
    await sql`SELECT pg_advisory_xact_lock(hashtext('farabi:tree-origin'))`.execute(trx);
    const { maxX } = await trx
      .selectFrom("trees")
      .select((eb) => eb.fn.max("layout_origin_x").as("maxX"))
      .where("project_id", "=", projectId) // each project's map starts at x = 0 (plan D5)
      .executeTakeFirstOrThrow();
    const x = (maxX === null ? -TREE_SPACING : Number(maxX)) + TREE_SPACING;

    const treeId = crypto.randomUUID();
    const nodeId = crypto.randomUUID();
    // trees.root_node_id is DEFERRABLE, so the tree can reference its root before the root exists.
    const tree = await trx
      .insertInto("trees")
      .values({ id: treeId, project_id: projectId, root_node_id: nodeId, layout_origin_x: x, layout_origin_y: 0 })
      .returningAll()
      .executeTakeFirstOrThrow();
    const node = await trx
      .insertInto("nodes")
      .values({ id: nodeId, tree_id: treeId, parent_id: null, provenance: "user_authored" })
      .returningAll()
      .executeTakeFirstOrThrow();

    return { tree: toTree(tree), node: toMapNode(node, null, placeholderFor(null)) };
  });
}

/**
 * Persists a tree's map origin (presentation only, research R4). `byUser` marks a tree the user
 * dragged, which is then never moved automatically (Feature 2, FR-020).
 */
export async function setTreeOrigin(treeId: string, x: number, y: number, byUser = false): Promise<MapTree> {
  const tree = await db
    .updateTable("trees")
    .set(byUser ? { layout_origin_x: x, layout_origin_y: y, user_placed: true } : { layout_origin_x: x, layout_origin_y: y })
    .where("id", "=", treeId)
    .returningAll()
    .executeTakeFirst();
  if (!tree) throw new NotFoundError("Tree not found");
  return toTree(tree);
}
