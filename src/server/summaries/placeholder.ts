import type { Summary } from "@/shared/schemas";

const MAX_ANCHOR_CHARS = 60;

/** Label shown before a node has an AI summary (FR-011). Never styled as an AI summary. */
export function placeholderFor(anchorText: string | null): Summary {
  if (anchorText === null) return { kind: "placeholder", text: "New conversation" };
  const clean = anchorText.replace(/\s+/g, " ").trim();
  const text =
    clean.length > MAX_ANCHOR_CHARS ? `${clean.slice(0, MAX_ANCHOR_CHARS - 1)}…` : clean;
  return { kind: "placeholder", text: `“${text}”` };
}
