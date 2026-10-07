import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// Per-browser display settings (Feature 5, research R8). Rehydrated after mount, so the server
// render and the first client render agree.
type SettingsStore = {
  /** Underline bold text in AI replies as places to branch (Feature 5, FR-012). On by default. */
  showSuggestions: boolean;
  setShowSuggestions: (show: boolean) => void;
  /** The side panel beside the canvas is open (Feature 8, FR-022). Open by default. */
  branchPanelOpen: boolean;
  setBranchPanelOpen: (open: boolean) => void;
  /** Draw rejected function outputs, faded (FR-050). Off by default. */
  showRejected: boolean;
  setShowRejected: (show: boolean) => void;
  /** The minimap is hidden (FR-027). Shown by default. */
  minimapHidden: boolean;
  setMinimapHidden: (hidden: boolean) => void;
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      showSuggestions: true,
      setShowSuggestions: (showSuggestions) => set({ showSuggestions }),
      branchPanelOpen: true,
      setBranchPanelOpen: (branchPanelOpen) => set({ branchPanelOpen }),
      showRejected: false,
      setShowRejected: (showRejected) => set({ showRejected }),
      minimapHidden: false,
      setMinimapHidden: (minimapHidden) => set({ minimapHidden }),
    }),
    {
      name: "farabi.settings",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        showSuggestions: s.showSuggestions,
        branchPanelOpen: s.branchPanelOpen,
        showRejected: s.showRejected,
        minimapHidden: s.minimapHidden,
      }),
      skipHydration: true,
    },
  ),
);
