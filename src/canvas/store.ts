// Client state for the canvas (research R12, R13): elements by id, trees, focus and selection,
// and per-target composer drafts (persisted, FR-028).
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { CanvasResponse, Element, Span, Tree } from "@/shared/schemas";

/** A composer target: an element id, or this sentinel for "start a new tree". */
export const NEW_TREE = "new-tree";

export type Selection = { elementId: string; span: Pick<Span, "start" | "end" | "text"> } | null;

type CanvasStore = {
  projectId: string | null;
  elements: Map<string, Element>;
  trees: Tree[];
  /** Bumps on every load or merge, so subscribers can react to data without deep comparison. */
  revision: number;
  focusId: string | null;
  /** The composer targets a new tree instead of the focused element (canvas menu "New tree"). */
  composingNewTree: boolean;
  selection: Selection;
  drafts: Record<string, string>;

  load: (projectId: string, canvas: Pick<CanvasResponse, "trees" | "elements">) => void;
  /** Adds or replaces elements (and trees) returned by an action. Returns the trees touched. */
  merge: (elements: Element[], trees?: Tree[]) => Set<string>;
  focus: (id: string | null) => void;
  setComposingNewTree: (on: boolean) => void;
  select: (selection: Selection) => void;
  setDraft: (targetId: string, text: string) => void;
};

export const useCanvasStore = create<CanvasStore>()(
  persist(
    (set, get) => ({
      projectId: null,
      elements: new Map(),
      trees: [],
      revision: 0,
      focusId: null,
      composingNewTree: false,
      selection: null,
      drafts: {},

      load: (projectId, canvas) => {
        const switched = get().projectId !== projectId;
        set((s) => ({
          projectId,
          elements: new Map(canvas.elements.map((e) => [e.id, e])),
          trees: canvas.trees,
          revision: s.revision + 1,
          ...(switched ? { focusId: null, selection: null, composingNewTree: false } : {}),
        }));
      },
      merge: (elements, trees) => {
        const touched = new Set<string>();
        set((s) => {
          const next = new Map(s.elements);
          for (const e of elements) {
            next.set(e.id, e);
            touched.add(e.treeId);
          }
          let nextTrees = s.trees;
          if (trees?.length) {
            const byId = new Map(s.trees.map((t) => [t.id, t]));
            for (const t of trees) byId.set(t.id, t);
            nextTrees = [...byId.values()];
          }
          return { elements: next, trees: nextTrees, revision: s.revision + 1 };
        });
        return touched;
      },
      focus: (focusId) => set({ focusId, composingNewTree: false }),
      setComposingNewTree: (composingNewTree) => set({ composingNewTree }),
      select: (selection) => set({ selection }),
      setDraft: (targetId, text) =>
        set((s) => {
          const drafts = { ...s.drafts };
          if (text) drafts[targetId] = text;
          else delete drafts[targetId];
          return { drafts };
        }),
    }),
    {
      // Drafts survive reloads (FR-028); data always comes from the server. Display settings
      // (show rejected, minimap) live in the settings store under farabi.settings.
      name: "farabi.drafts",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ drafts: s.drafts }),
      skipHydration: true,
    },
  ),
);

/** Hidden: rejected outputs, and function edges whose outputs are all rejected (FR-050). */
export function isVisible(el: Element, showRejected: boolean): boolean {
  return showRejected || el.review !== "rejected";
}

/** The newest attempt under an edge (by creation time, then id). */
export function newestAnswer(edgeId: string, elements: Iterable<Element>): Element | undefined {
  let best: Element | undefined;
  for (const e of elements) {
    if (e.parentId !== edgeId || e.kind !== "answer") continue;
    if (!best || e.createdAt > best.createdAt || (e.createdAt === best.createdAt && e.id > best.id)) best = e;
  }
  return best;
}
