import { analogyKind } from "./analogy";
import { conversationKind } from "./conversation";
import { pipeKind } from "./pipe";
import type { NodeKindDeclaration } from "./types";

export type { NodeKindDeclaration, SettingDeclaration, ViewId } from "./types";

// Node kinds (Feature 9, research R2). Adding a kind means adding a declaration here.
const registry = new Map<string, NodeKindDeclaration>();

/** Adds a kind. Used for the built-in kinds below and by tests (SC-007). */
export function registerKind(decl: NodeKindDeclaration): void {
  if (registry.has(decl.id)) throw new Error(`Node kind "${decl.id}" is already registered`);
  const keys = new Set<string>();
  for (const s of decl.settings) {
    if (keys.has(s.key)) throw new Error(`Node kind "${decl.id}" declares "${s.key}" twice`);
    keys.add(s.key);
    if (!s.choices.some((c) => c.value === s.default)) {
      throw new Error(`The default for "${decl.id}.${s.key}" isn't one of its choices`);
    }
  }
  registry.set(decl.id, decl);
}

for (const kind of [conversationKind, analogyKind, pipeKind]) registerKind(kind);

export function findKind(id: string): NodeKindDeclaration | undefined {
  return registry.get(id);
}

export function getKind(id: string): NodeKindDeclaration {
  const kind = registry.get(id);
  if (!kind) throw new Error(`Unknown node kind "${id}"`);
  return kind;
}

export function allKinds(): NodeKindDeclaration[] {
  return [...registry.values()];
}

export function kindsWithSettings(): NodeKindDeclaration[] {
  return allKinds().filter((k) => k.settings.length > 0);
}
