// The user's review of a function output (Feature 9, research R5). Each action appends an event;
// nothing is deleted or rewritten (FR-027, FR-028, Articles I and II).
import type { MapNode } from "@/shared/schemas";
import { db } from "../db/client";
import { ConflictError, NotFoundError } from "../errors";
import { assertId } from "../ids";
import { NO_SUMMARY, toMapNode } from "../mappers";
import { type OutputState, outputStates, toOutputSummary } from "./state";

async function load(outputId: string): Promise<OutputState> {
  assertId(outputId, "Node");
  const node = await db.selectFrom("nodes").select("kind").where("id", "=", outputId).executeTakeFirst();
  if (!node) throw new NotFoundError("Node not found");
  const state = (await outputStates([outputId])).get(outputId);
  if (!state) throw new ConflictError("wrong_kind", "This node isn't a function output", { kind: node.kind });
  return state;
}

async function result(outputId: string): Promise<{ output: MapNode }> {
  const [node, state] = await Promise.all([
    db.selectFrom("nodes").selectAll().where("id", "=", outputId).executeTakeFirstOrThrow(),
    load(outputId),
  ]);
  return { output: toMapNode(node, null, NO_SUMMARY, null, 0, toOutputSummary(state)) };
}

/**
 * The user vouches for the latest version: it becomes the displayed text until they confirm
 * another (FR-026). Confirming a rejected output brings it back.
 */
export async function confirmOutput(outputId: string, versionId: string): Promise<{ output: MapNode }> {
  const state = await load(outputId);
  if (!state.versions.some((v) => v.id === versionId)) throw new NotFoundError("Version not found");
  if (versionId !== state.latest.id) throw new ConflictError("not_latest", "Only the newest version can be confirmed");
  if (state.review === "confirmed" && state.confirmedVersionId === versionId) {
    throw new ConflictError("already_confirmed", "This version is already confirmed");
  }
  await db
    .insertInto("function_output_events")
    .values({ output_node_id: outputId, kind: "confirmed", version_id: versionId, provenance: "user_confirmed" })
    .execute();
  return result(outputId);
}

/** Hides the output and its pipe from the map; the record stays (FR-027). */
export async function rejectOutput(outputId: string): Promise<{ output: MapNode }> {
  const state = await load(outputId);
  if (state.review === "rejected") throw new ConflictError("already_rejected", "This is already rejected");
  await db
    .insertInto("function_output_events")
    .values({ output_node_id: outputId, kind: "rejected", version_id: null, provenance: "user_authored" })
    .execute();
  return result(outputId);
}
