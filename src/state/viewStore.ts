import { create } from "zustand";

// Per-node view state kept in memory for the session (research R7).
type NodeViewState = { scrollTop: number | null; draft: string };

export type PanelTab = "branches" | "parked";

type ViewStore = {
  byNode: Record<string, NodeViewState>;
  lastNodeId: string | null;
  /** Selected tab of the branch panel (Feature 8). */
  panelTab: PanelTab;
  setPanelTab: (tab: PanelTab) => void;
  setScroll: (nodeId: string, scrollTop: number) => void;
  setDraft: (nodeId: string, draft: string) => void;
  setLastNode: (nodeId: string) => void;
};

const empty: NodeViewState = { scrollTop: null, draft: "" };

export const useViewStore = create<ViewStore>((set) => ({
  byNode: {},
  lastNodeId: null,
  panelTab: "branches",
  setPanelTab: (panelTab) => set({ panelTab }),
  setScroll: (nodeId, scrollTop) =>
    set((s) => ({ byNode: { ...s.byNode, [nodeId]: { ...(s.byNode[nodeId] ?? empty), scrollTop } } })),
  setDraft: (nodeId, draft) =>
    set((s) => ({ byNode: { ...s.byNode, [nodeId]: { ...(s.byNode[nodeId] ?? empty), draft } } })),
  setLastNode: (nodeId) => set({ lastNodeId: nodeId }),
}));

export function nodeViewState(nodeId: string): NodeViewState {
  return useViewStore.getState().byNode[nodeId] ?? empty;
}
