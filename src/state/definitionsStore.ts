import { create } from "zustand";
import { api } from "@/lib/api";
import { buildMatcher, type TermMatcher } from "@/lib/terms";
import type { Definition } from "@/shared/schemas";

type DefinitionsStore = {
  matcher: TermMatcher | null;
  entries: Record<string, Definition>;
  /** Reloads the term index used to underline terms (FR-036a). */
  refreshIndex: () => Promise<void>;
  /** Fetches (or refreshes) one entry for the hover card. */
  loadEntry: (id: string) => Promise<Definition | null>;
  remember: (definition: Definition) => void;
};

export const useDefinitionsStore = create<DefinitionsStore>((set, get) => ({
  matcher: null,
  entries: {},
  refreshIndex: async () => {
    const { terms } = await api.getTermIndex();
    set({ matcher: buildMatcher(terms) });
  },
  loadEntry: async (id) => {
    try {
      const { definition } = await api.getDefinition(id);
      get().remember(definition);
      return definition;
    } catch {
      return get().entries[id] ?? null;
    }
  },
  remember: (definition) => set((s) => ({ entries: { ...s.entries, [definition.id]: definition } })),
}));
