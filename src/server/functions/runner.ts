// The generic function runner (contracts/declarations.md "Runner", research R14). It executes any
// registered definition and holds nothing specific to one function or kind: adding either never
// changes this file (SC-013). A function runs only when the user asks. The AI is called before
// anything is written, so a failed run leaves no trace (FR-052).
import type { Element, RunFunctionResponse } from "@/shared/schemas";
import { getAIProvider } from "../ai";
import { AIUnavailableError } from "../ai/provider";
import { db } from "../db/client";
import { ConflictError, FunctionUnavailableError } from "../errors";
import { type ElementRow, insertElement, loadLive, toElement } from "../graph/elements";
import { assertId } from "../ids";
import { resolvedValues } from "../settings/kindSettings";
import { type FunctionDefinition, getFunction, listFunctionsFor } from "./definitions";

/** The input's own immutable text (`reads: "text"`); refuses text that isn't final yet. */
function readText(input: ElementRow): string {
  if (input.text === null || input.text.trim() === "" || (input.status !== null && input.status !== "complete")) {
    throw new ConflictError("not_runnable", "This text isn't finished yet");
  }
  return input.text;
}

/** Asks the AI; nothing is stored here. */
async function generate(def: FunctionDefinition, input: ElementRow, settings: Record<string, string>): Promise<string> {
  const text = readText(input);
  try {
    const raw = await getAIProvider().complete({
      tag: def.id,
      system: def.instruction.system(settings),
      prompt: def.instruction.prompt({ text }, settings),
    });
    return def.parse(raw);
  } catch (err) {
    if (err instanceof AIUnavailableError) throw new FunctionUnavailableError(err.message);
    throw err;
  }
}

function outputValues(def: FunctionDefinition, edge: Pick<ElementRow, "id" | "tree_id" | "project_id">, text: string) {
  return {
    kind: def.outputKind,
    parentId: edge.id,
    treeId: edge.tree_id,
    projectId: edge.project_id,
    origin: "run" as const,
    provenance: "ai_suggested" as const,
    text,
    functionId: def.id,
    functionVersion: def.version,
  };
}

/** Runs a function on an element at the user's request: a function edge and its first output. */
export async function runFunction(functionId: string, inputId: string): Promise<RunFunctionResponse> {
  assertId(inputId, "Element");
  const input = await loadLive(db, inputId);
  const def = getFunction(functionId);
  if (!def.accepts.includes(input.kind)) {
    throw new ConflictError("wrong_kind", `${def.name} can't run on this kind of element`, { kind: input.kind });
  }
  // A first run has no override yet: the kind-level value or the default applies (FR-053).
  const settings = await resolvedValues(def.outputKind);
  const text = await generate(def, input, settings);

  const { edge, output } = await db.transaction().execute(async (trx) => {
    const edge = await insertElement(trx, {
      kind: def.edgeKind,
      parentId: input.id,
      treeId: input.tree_id,
      projectId: input.project_id,
      origin: "run",
      provenance: "ai_suggested",
      functionId: def.id,
      functionVersion: def.version,
    });
    const output = await insertElement(trx, outputValues(def, edge, text));
    return { edge, output };
  });
  return { edge: toElement(edge, { review: "proposed" }), output: toElement(output, { review: "proposed" }) };
}

/** Another output under an existing function edge, with that edge's override (FR-051, FR-053). */
export async function rerunFunction(edgeId: string): Promise<{ output: Element }> {
  assertId(edgeId, "Edge");
  const edge = await loadLive(db, edgeId);
  if (edge.origin !== "run" || edge.shape !== "edge" || edge.function_id === null || edge.parent_id === null) {
    throw new ConflictError("wrong_kind", "Only a function edge can run again", { kind: edge.kind });
  }
  const def = getFunction(edge.function_id);
  const input = await loadLive(db, edge.parent_id);
  const settings = await resolvedValues(def.outputKind, edge.id);
  const text = await generate(def, input, settings);
  const output = await insertElement(db, outputValues(def, edge, text));
  return { output: toElement(output, { review: "proposed" }) };
}

/** The function menu for an element: only functions that accept its kind (story 8). */
export async function listAvailableFunctions(elementId: string) {
  assertId(elementId, "Element");
  const el = await loadLive(db, elementId);
  return {
    functions: listFunctionsFor(el.kind).map((def) => ({
      id: def.id,
      name: def.name,
      version: def.version,
      outputKind: def.outputKind,
    })),
  };
}
