import { create } from "zustand";
import { api } from "@/lib/api";
import type { FeedbackContext } from "@/lib/feedbackContext";
import { makeThumbnail } from "@/lib/thumbnail";
import {
  FEEDBACK_MAX_IMAGE_BYTES,
  FEEDBACK_MAX_IMAGES,
  type FeedbackItem,
} from "@/shared/schemas";
import { termKey } from "@/shared/termKey";

export type DraftImage = { id: string; file: File; previewUrl: string; thumb: Blob | null };

type Draft = { text: string; tags: string[]; images: DraftImage[] };

const emptyDraft: Draft = { text: "", tags: [], images: [] };

type FeedbackStore = {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Kept while the drawer is closed (research R1). */
  draft: Draft;
  draftError: string | null;
  setText: (text: string) => void;
  addTag: (tag: string) => void;
  removeTag: (tag: string) => void;
  addImages: (files: File[]) => Promise<void>;
  removeImage: (id: string) => void;
  items: FeedbackItem[];
  loaded: boolean;
  load: () => Promise<void>;
  submit: (context: FeedbackContext) => Promise<boolean>;
  /** Moves `id` so it lands at `toIndex` among `visibleIds` (the list as currently shown). */
  move: (id: string, toIndex: number, visibleIds: string[]) => Promise<void>;
  resolve: (id: string) => Promise<void>;
  reopen: (id: string) => Promise<void>;
  filterKey: string | null;
  setFilter: (key: string | null) => void;
};

const replaceItem = (items: FeedbackItem[], item: FeedbackItem) => items.map((i) => (i.id === item.id ? item : i));

export const useFeedbackStore = create<FeedbackStore>((set, get) => ({
  open: false,
  setOpen: (open) => set({ open }),

  draft: emptyDraft,
  draftError: null,
  setText: (text) => set((s) => ({ draft: { ...s.draft, text } })),
  addTag: (tag) => {
    const clean = tag.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!clean) return;
    set((s) =>
      s.draft.tags.some((t) => termKey(t) === termKey(clean)) ? s : { draft: { ...s.draft, tags: [...s.draft.tags, clean] } },
    );
  },
  removeTag: (tag) => set((s) => ({ draft: { ...s.draft, tags: s.draft.tags.filter((t) => t !== tag) } })),
  addImages: async (files) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    const room = FEEDBACK_MAX_IMAGES - get().draft.images.length;
    let error: string | null = null;
    const accepted = images.filter((f) => {
      if (f.size > FEEDBACK_MAX_IMAGE_BYTES) {
        error = `${f.name || "That image"} is larger than 10 MB.`;
        return false;
      }
      return true;
    });
    if (accepted.length > room) error = `At most ${FEEDBACK_MAX_IMAGES} images per item.`;
    const added = await Promise.all(
      accepted.slice(0, Math.max(0, room)).map(async (file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        thumb: await makeThumbnail(file),
      })),
    );
    set((s) => ({ draft: { ...s.draft, images: [...s.draft.images, ...added] }, draftError: error }));
  },
  removeImage: (id) =>
    set((s) => {
      const gone = s.draft.images.find((i) => i.id === id);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return { draft: { ...s.draft, images: s.draft.images.filter((i) => i.id !== id) }, draftError: null };
    }),

  items: [],
  loaded: false,
  load: async () => {
    const { items } = await api.listFeedback();
    set({ items, loaded: true });
  },
  submit: async (context) => {
    const { draft } = get();
    if (!draft.text.trim()) return false;
    try {
      const { item } = await api.createFeedback(
        { text: draft.text, view: context.view, projectId: context.projectId, elementId: context.elementId, tags: draft.tags },
        draft.images.map((i) => ({ file: i.file, thumb: i.thumb })),
      );
      for (const img of draft.images) URL.revokeObjectURL(img.previewUrl);
      set((s) => ({ items: [item, ...s.items.filter((i) => i.id !== item.id)], draft: emptyDraft, draftError: null }));
      return true;
    } catch (err) {
      set({ draftError: err instanceof Error ? err.message : "Could not save feedback." });
      return false;
    }
  },
  move: async (id, toIndex, visibleIds) => {
    const from = visibleIds.indexOf(id);
    if (from < 0) return;
    const rest = visibleIds.filter((v) => v !== id);
    const index = Math.max(0, Math.min(toIndex, rest.length));
    if (index === from) return;
    const aboveId = rest[index - 1] ?? null;
    const belowId = rest[index] ?? null;
    // Optimistic: place it next to its new neighbours in the full list.
    set((s) => {
      const moving = s.items.find((i) => i.id === id);
      if (!moving) return s;
      const others = s.items.filter((i) => i.id !== id);
      const at = aboveId
        ? others.findIndex((i) => i.id === aboveId) + 1
        : Math.max(0, others.findIndex((i) => i.id === belowId));
      others.splice(at, 0, { ...moving, manuallyPlaced: true });
      return { items: others };
    });
    try {
      const { item } = await api.moveFeedback(id, aboveId, belowId);
      set((s) => ({ items: replaceItem(s.items, item) }));
    } catch {
      await get().load();
    }
  },
  resolve: async (id) => {
    const { item } = await api.resolveFeedback(id);
    set((s) => ({ items: replaceItem(s.items, item) }));
  },
  reopen: async (id) => {
    const { item } = await api.reopenFeedback(id);
    set((s) => ({ items: replaceItem(s.items, item) }));
  },

  filterKey: null,
  setFilter: (key) => set({ filterKey: key }),
}));

/** Items shown under the current tag filter; order is never changed by filtering. */
export function visibleItems(items: FeedbackItem[], filterKey: string | null): FeedbackItem[] {
  return filterKey ? items.filter((i) => i.tags.some((t) => t.key === filterKey)) : items;
}
