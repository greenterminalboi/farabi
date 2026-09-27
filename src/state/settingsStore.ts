import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// Per-browser display settings (Feature 5, research R8). Rehydrated after mount, so the server
// render and the first client render agree.
type SettingsStore = {
  /** Show suggested places to branch (FR-012). On by default. */
  showSuggestions: boolean;
  setShowSuggestions: (show: boolean) => void;
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      showSuggestions: true,
      setShowSuggestions: (showSuggestions) => set({ showSuggestions }),
    }),
    {
      name: "farabi.settings",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ showSuggestions: s.showSuggestions }),
      skipHydration: true,
    },
  ),
);
