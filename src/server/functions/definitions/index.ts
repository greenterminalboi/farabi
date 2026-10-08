import { findKind } from "@/shared/kinds";
import { NotFoundError } from "../../errors";
import { analogy } from "./analogy";
import { premortem } from "./premortem";
import { scqa } from "./scqa";
import { steelman } from "./steelman";
import type { FunctionDefinition } from "./types";

export type { FunctionDefinition } from "./types";

// Functions (Feature 9, research R14). Adding a function means adding a definition here.
const registry = new Map<string, FunctionDefinition>();

/** Adds a function. Used for the built-in functions below and by tests (SC-006). */
export function registerFunction(def: FunctionDefinition): void {
  if (registry.has(def.id)) throw new Error(`Function "${def.id}" is already registered`);
  const output = findKind(def.outputKind);
  if (!output) throw new Error(`Function "${def.id}" creates unknown kind "${def.outputKind}"`);
  if (output.shape !== "node") throw new Error(`Function "${def.id}" must create a node, not ${output.shape} kind "${def.outputKind}"`);
  if (findKind(def.edgeKind)?.shape !== "edge") throw new Error(`Function "${def.id}" is recorded as unknown edge kind "${def.edgeKind}"`);
  if (!def.accepts.every((k) => output.acceptsInputKinds?.includes(k))) {
    throw new Error(`Kind "${def.outputKind}" doesn't accept every input kind of "${def.id}"`);
  }
  registry.set(def.id, def);
}

registerFunction(analogy);
// Feature 13: the lexicon's methods; the runner is unchanged (FR-017).
for (const method of [premortem, steelman, scqa]) registerFunction(method);

export function getFunction(id: string): FunctionDefinition {
  const def = registry.get(id);
  if (!def) throw new NotFoundError("Unknown function");
  return def;
}

export function findFunction(id: string): FunctionDefinition | undefined {
  return registry.get(id);
}

/** Functions that can run on an element of this kind (FR-047). */
export function listFunctionsFor(kind: string): FunctionDefinition[] {
  return [...registry.values()].filter((f) => f.accepts.includes(kind));
}
