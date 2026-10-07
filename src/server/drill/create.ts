// Creating a drill (FR-001, FR-002, FR-033): the AI proposes a ladder first, then the drill_start
// edge, the drill node, the drills row and ladder version 1 are written in one transaction, so a
// failed proposal leaves nothing behind (Story 1 AS4).
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { AIUnavailableError } from "../ai/provider";
import { db, type Trx } from "../db/client";
import type { Provenance, StoredRung } from "../db/schema";
import { ConflictError, FunctionUnavailableError, InvalidRequestError, NotFoundError } from "../errors";
import { insertElement, loadLive } from "../graph/elements";
import { assertId } from "../ids";
import { drillModel } from "./model";
import { callOperation, drillLadder, installDrillFakes } from "./operations";
import type { AttachedText } from "./operations/ladder";

export const MAX_DOMAIN = 300;
/** Horizontal distance between new trees' origins, as for asked trees (Feature 10). */
const TREE_SPACING = 2000;

export function cleanDomain(domain: string): string {
  const d = domain.trim().replace(/\s+/g, " ");
  if (d.length < 1 || d.length > MAX_DOMAIN) throw new InvalidRequestError(`A domain is 1 to ${MAX_DOMAIN} characters`);
  return d;
}

async function assertLiveProject(trx: Trx, projectId: string): Promise<void> {
  const live = await trx.selectFrom("projects").select("id").where("id", "=", projectId).where("trashed_at", "is", null).executeTakeFirst();
  if (!live) throw new NotFoundError("Project not found");
}

/** A new tree for a drill typed on the canvas, placed like a new asked tree. */
async function newTree(trx: Trx, projectId: string): Promise<string> {
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
    .returning("id")
    .executeTakeFirstOrThrow();
  return tree.id;
}

/** Proposes a ladder; an AI failure becomes a 503 that wrote nothing. */
export async function proposeLadder(domain: string, attachments: AttachedText[]): Promise<string[]> {
  installDrillFakes();
  try {
    const out = await callOperation(drillLadder, { domain, attachments }, { model: await drillModel() });
    return out.rungs;
  } catch (err) {
    if (err instanceof AIUnavailableError) throw new FunctionUnavailableError(err.message);
    throw err;
  }
}

export type CreateDrillInput = { projectId: string; domain: string; sourceNodeId?: string; offerId?: string };

/** Creates a drill and returns its id. Picking an offered starting point links the parent (FR-033). */
export async function createDrill(input: CreateDrillInput): Promise<string> {
  assertId(input.projectId, "Project");
  const domain = cleanDomain(input.domain);
  let offer: { id: string; drill_id: string; candidates: Array<{ nodeId: string; domain: string }> } | undefined;
  if (input.offerId) {
    assertId(input.offerId, "Offer");
    offer = await db.selectFrom("drill_offers").select(["id", "drill_id", "candidates"]).where("id", "=", input.offerId).executeTakeFirst();
    if (!offer) throw new NotFoundError("Offer not found");
    if (!input.sourceNodeId || !offer.candidates.some((c) => c.nodeId === input.sourceNodeId)) {
      throw new ConflictError("not_offered", "That starting point isn't part of this offer");
    }
  }
  if (input.sourceNodeId) {
    assertId(input.sourceNodeId, "Element");
    const source = await loadLive(db, input.sourceNodeId);
    if (source.project_id !== input.projectId) throw new ConflictError("wrong_project", "The starting point is in another project");
  }

  const names = await proposeLadder(domain, []);

  return db.transaction().execute(async (trx) => {
    await assertLiveProject(trx, input.projectId);
    const source = input.sourceNodeId ? await loadLive(trx, input.sourceNodeId) : null;
    const treeId = source ? source.tree_id : await newTree(trx, input.projectId);
    const start = await insertElement(trx, {
      kind: "drill_start",
      parentId: source?.id ?? null,
      treeId,
      projectId: input.projectId,
      origin: source ? "drill" : "origin",
      provenance: "user_authored",
      text: domain,
      sentAt: new Date(),
    });
    const node = await insertElement(trx, {
      kind: "drill",
      parentId: start.id,
      treeId,
      projectId: input.projectId,
      origin: "drill",
      provenance: "user_authored",
      text: "",
    });
    const offered = offer?.candidates.find((c) => c.nodeId === input.sourceNodeId);
    // An offered domain accepted as it was is the user's confirmation of the AI's words (Article I).
    const sameAsOffered = offered !== undefined && offered.domain.trim().replace(/\s+/g, " ") === domain;
    const domainProvenance: Provenance = sameAsOffered ? "user_confirmed" : "user_authored";
    const drill = await trx
      .insertInto("drills")
      .values({
        project_id: input.projectId,
        node_id: node.id,
        domain,
        domain_provenance: domainProvenance,
        source_node_id: source?.id ?? null,
        parent_drill_id: offer?.drill_id ?? null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const rungs: StoredRung[] = names.map((name) => ({ id: randomUUID(), name, provenance: "ai_suggested", removed: false }));
    await trx.insertInto("drill_ladder_versions").values({ drill_id: drill.id, rungs: JSON.stringify(rungs), provenance: "ai_suggested" }).execute();
    if (offer && source) {
      await trx.insertInto("drill_offer_events").values({ offer_id: offer.id, type: "picked", node_id: source.id, new_drill_id: drill.id }).execute();
    }
    return drill.id;
  });
}
