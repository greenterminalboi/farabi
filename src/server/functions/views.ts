// What the output and pipe views show (Feature 9, contracts/http-api.md). Read-only.
import type { MapNode, OutputViewResponse, PipeViewResponse } from "@/shared/schemas";
import { db } from "../db/client";
import { ConflictError, NotFoundError } from "../errors";
import { getIncomingMarker, latestSummary, liveMessages } from "../forest/nodeView";
import { assertId } from "../ids";
import { NO_SUMMARY, toMapNode, toMapPipe, toMessage, toOutputVersion, toSummary } from "../mappers";
import { resolveKindSettings } from "../settings/kindSettings";
import { findFunction } from "./definitions";
import { type OutputState, outputStates, toOutputSummary } from "./state";

async function loadNode(nodeId: string) {
  assertId(nodeId, "Node");
  const node = await db.selectFrom("nodes").selectAll().where("id", "=", nodeId).executeTakeFirst();
  if (!node) throw new NotFoundError("Node not found");
  return node;
}

async function conversationNode(nodeId: string): Promise<MapNode> {
  const node = await loadNode(nodeId);
  const [incoming, summary] = await Promise.all([getIncomingMarker(nodeId), latestSummary(nodeId)]);
  const anchorText = incoming?.anchor_text ?? null;
  return toMapNode(node, anchorText, toSummary(summary, anchorText));
}

async function outputParts(outputId: string): Promise<{ node: MapNode; state: OutputState }> {
  const node = await loadNode(outputId);
  const state = (await outputStates([outputId])).get(outputId);
  if (!state) throw new ConflictError("wrong_kind", "This node isn't a function output", { kind: node.kind });
  return { node: toMapNode(node, null, NO_SUMMARY, null, 0, toOutputSummary(state)), state };
}

async function pipeOf(state: OutputState) {
  const pipeNode = await db.selectFrom("nodes").selectAll().where("id", "=", state.pipe.node_id).executeTakeFirstOrThrow();
  const name = findFunction(state.pipe.function_id)?.name ?? state.pipe.function_id;
  return toMapPipe(pipeNode, state.pipe, name, state.review);
}

/** The output beside its input (FR-019): versions, the input's conversation, and settings. */
export async function getOutputView(outputId: string): Promise<OutputViewResponse> {
  const { node, state } = await outputParts(outputId);
  const inputId = state.pipe.input_node_id;
  const [pipe, input, messages, settings] = await Promise.all([
    pipeOf(state),
    conversationNode(inputId),
    liveMessages(inputId),
    resolveKindSettings(node.kind, node.id),
  ]);
  return {
    node,
    pipe,
    versions: state.versions.map((v) => toOutputVersion(v, state.confirmedVersionId)),
    input: { node: input, messages: messages.map(toMessage) },
    settings,
  };
}

/** A pipe's function, versions and state (FR-017). */
export async function getPipeView(pipeId: string): Promise<PipeViewResponse> {
  const node = await loadNode(pipeId);
  if (node.kind !== "pipe") throw new ConflictError("wrong_kind", "This node isn't a pipe", { kind: node.kind });
  const row = await db.selectFrom("pipes").select("output_node_id").where("node_id", "=", pipeId).executeTakeFirstOrThrow();
  const { node: output, state } = await outputParts(row.output_node_id);
  const [pipe, input] = await Promise.all([pipeOf(state), conversationNode(state.pipe.input_node_id)]);
  return { pipe, input, output, versionCount: state.versions.length, stale: state.stale };
}
