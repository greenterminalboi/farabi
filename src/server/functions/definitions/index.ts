import { findKind } from "@/shared/kinds";
import { NotFoundError } from "../../errors";
import { analogy } from "./analogy";
import type { FunctionDefinition } from "./types";

export type { FunctionDefinition } from "./types";

// Node functions (Feature 9, research R2). Adding a function means adding a definition here.
const registry = new Map<string, FunctionDefinition>();

/** Adds a function. Used for the built-in functions below and by tests (SC-006). */
export function registerFunction(def: FunctionDefinition): void {
  if (registry.has(def.id)) throw new Error(`Function "${def.id}" is already registered`);
  const output = findKind(def.outputKind);
  if (!output) throw new Error(`Function "${def.id}" creates unknown kind "${def.outputKind}"`);
  if (!def.accepts.every((k) => output.acceptsInputKinds?.includes(k))) {
    throw new Error(`Kind "${def.outputKind}" doesn't accept every input kind of "${def.id}"`);
  }
  registry.set(def.id, def);
}

registerFunction(analogy);

export function getFunction(id: string): FunctionDefinition {
  const def = registry.get(id);
  if (!def) throw new NotFoundError("Unknown function");
  return def;
}

export function findFunction(id: string): FunctionDefinition | undefined {
  return registry.get(id);
}

/** Functions that can run on a node of this kind (FR-009). */
export function listFunctionsFor(kind: string): FunctionDefinition[] {
  return [...registry.values()].filter((f) => f.accepts.includes(kind));
}
