// The generic node-function runner (Feature 9, research R3). It executes any registered definition
// and holds nothing specific to one function: adding a function never changes this file (FR-008).
// A function runs only when the user asks (FR-024). The AI is called before anything is written,
// so a failed run leaves no trace (FR-012).
import type { Selectable } from "kysely";
import type { MapNode, MapPipe, OutputVersion } from "@/shared/schemas";
import { getAIProvider } from "../ai";
import { AIUnavailableError } from "../ai/provider";
import { db } from "../db/client";
import type { NodesTable } from "../db/schema";
import { ConflictError, FunctionUnavailableError, NotFoundError } from "../errors";
import { assertId } from "../ids";
import { NO_SUMMARY, toMapNode, toMapPipe, toOutputVersion } from "../mappers";
import { validateProperties } from "../nodes/kinds";
import { resolvedValues } from "../settings/kindSettings";
import { type FunctionDefinition, getFunction, listFunctionsFor } from "./definitions";
import { READERS } from "./readers";
import { outputStates, toOutputSummary } from "./state";

/** A node in a project that isn't in the trash (FR-013). */
async function loadLiveNode(nodeId: string): Promise<Selectable<NodesTable>> {
  assertId(nodeId, "Node");
  const node = await db
    .selectFrom("nodes")
    .innerJoin("trees", "trees.id", "nodes.tree_id")
    .innerJoin("projects", "projects.id", "trees.project_id")
    .selectAll("nodes")
    .where("nodes.id", "=", nodeId)
    .where("projects.trashed_at", "is", null)
    .executeTakeFirst();
  if (!node) throw new NotFoundError("Node not found");
  return node;
}

/** Reads the declared part of the input, then asks the AI; nothing is stored here. */
async function generate(def: FunctionDefinition, inputNodeId: string, settings: Record<string, string>) {
  // The version is captured before the AI call: if the source changes meanwhile, the result is
  // correctly stale as soon as it lands (spec edge case).
  const source = await READERS[def.reads].read(inputNodeId);
  if (!source.ok) throw new ConflictError("function_unavailable", source.reason);
  try {
    const raw = await getAIProvider().complete({
      tag: def.id,
      system: def.instruction.system(settings),
      prompt: def.instruction.prompt({ text: source.text }, settings),
    });
    return { text: def.parse(raw), sourceVersion: source.version };
  } catch (err) {
    if (err instanceof AIUnavailableError) throw new FunctionUnavailableError(err.message);
    throw err;
  }
}

async function outputNode(outputId: string): Promise<MapNode> {
  const [node, states] = await Promise.all([
    db.selectFrom("nodes").selectAll().where("id", "=", outputId).executeTakeFirstOrThrow(),
    outputStates([outputId]),
  ]);
  const state = states.get(outputId);
  return toMapNode(node, null, NO_SUMMARY, null, 0, state ? toOutputSummary(state) : null);
}

/** Runs a function on a node at the user's request: a new output node, its pipe and version 1. */
export async function runFunction(functionId: string, inputNodeId: string): Promise<{ output: MapNode; pipe: MapPipe }> {
  const input = await loadLiveNode(inputNodeId);
  const def = getFunction(functionId);
  if (!def.accepts.includes(input.kind)) {
    throw new ConflictError("wrong_kind", `${def.name} can't run on this kind of node`, { kind: input.kind });
  }
  // A new output has no override yet: the kind-level value or the default applies (research R7).
  const settings = await resolvedValues(def.outputKind);
  const { text, sourceVersion } = await generate(def, input.id, settings);

  const { outputId, pipeNode, pipe } = await db.transaction().execute(async (trx) => {
    const common = {
      tree_id: input.tree_id,
      parent_id: null,
      provenance: "ai_suggested" as const,
      origin: "function" as const,
      function_id: def.id,
      function_version: def.version,
    };
    const output = await trx
      .insertInto("nodes")
      .values({ ...common, kind: def.outputKind, properties: JSON.stringify(validateProperties(def.outputKind, {})) })
      .returning("id")
      .executeTakeFirstOrThrow();
    const pipeNode = await trx
      .insertInto("nodes")
      .values({ ...common, kind: "pipe", properties: JSON.stringify(validateProperties("pipe", {})) })
      .returningAll()
      .executeTakeFirstOrThrow();
    const pipe = await trx
      .insertInto("pipes")
      .values({
        node_id: pipeNode.id,
        input_node_id: input.id,
        output_node_id: output.id,
        reads: def.reads,
        function_id: def.id,
        function_version: def.version,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("function_output_versions")
      .values({
        output_node_id: output.id,
        text,
        source_version: sourceVersion,
        function_version: def.version,
        settings: JSON.stringify(settings),
      })
      .execute();
    return { outputId: output.id, pipeNode, pipe };
  });

  return { output: await outputNode(outputId), pipe: toMapPipe(pipeNode, pipe, def.name, "proposed") };
}

/**
 * Makes a new version of an output from its input's current state, at the user's request (FR-025).
 * The review is untouched: a confirmed text stays displayed until the user confirms this one.
 */
export async function regenerateOutput(outputNodeId: string): Promise<{ output: MapNode; version: OutputVersion }> {
  const node = await loadLiveNode(outputNodeId);
  const pipe = await db.selectFrom("pipes").selectAll().where("output_node_id", "=", node.id).executeTakeFirst();
  if (!pipe) throw new ConflictError("wrong_kind", "Only a function output can be regenerated", { kind: node.kind });
  const def = getFunction(pipe.function_id);
  // This node's own override applies here (FR-030).
  const settings = await resolvedValues(node.kind, node.id);
  const { text, sourceVersion } = await generate(def, pipe.input_node_id, settings);
  const version = await db
    .insertInto("function_output_versions")
    .values({
      output_node_id: node.id,
      text,
      source_version: sourceVersion,
      function_version: def.version,
      settings: JSON.stringify(settings),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const output = await outputNode(node.id);
  const state = (await outputStates([node.id])).get(node.id);
  return { output, version: toOutputVersion(version, state?.confirmedVersionId ?? null) };
}

/** The function menu for a node: what accepts its kind, and whether it can run now (FR-009, FR-010). */
export async function listAvailableFunctions(nodeId: string) {
  const node = await loadLiveNode(nodeId);
  const functions = await Promise.all(
    listFunctionsFor(node.kind).map(async (def) => {
      const source = await READERS[def.reads].read(node.id);
      return {
        id: def.id,
        name: def.name,
        version: def.version,
        outputKind: def.outputKind,
        available: source.ok,
        reason: source.ok ? null : source.reason,
      };
    }),
  );
  return { functions };
}
