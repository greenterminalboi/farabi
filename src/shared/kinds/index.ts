import { analogyKind } from "./analogy";
import { DRILL_KINDS } from "./drill";
import { answerKind } from "./answer";
import { functionKind } from "./function";
import { premortemKind } from "./premortem";
import { questionKind } from "./question";
import { scqaKind } from "./scqa";
import { steelmanKind } from "./steelman";
import { DISPLAY_SHAPE, type NodeKindDeclaration } from "./types";

export type { Display, NodeKindDeclaration, SettingDeclaration, Shape } from "./types";

// Element kinds (Feature 9, research R14). Adding a kind means adding a declaration here.
const registry = new Map<string, NodeKindDeclaration>();

/** Adds a kind. Used for the built-in kinds below and by tests (SC-007). */
export function registerKind(decl: NodeKindDeclaration): void {
  if (registry.has(decl.id)) throw new Error(`Node kind "${decl.id}" is already registered`);
  if (DISPLAY_SHAPE[decl.display] !== decl.shape) {
    const drawn = DISPLAY_SHAPE[decl.display] === "edge" ? "an edge" : "a node";
    throw new Error(`Node kind "${decl.id}" has shape "${decl.shape}", but display "${decl.display}" draws ${drawn}`);
  }
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

// Feature 13: the lexicon's methods are output kinds made by functions (research R7).
const METHOD_KINDS = [premortemKind, steelmanKind, scqaKind];

for (const kind of [questionKind, answerKind, functionKind, analogyKind, ...DRILL_KINDS, ...METHOD_KINDS]) registerKind(kind);

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
