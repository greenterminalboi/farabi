// Lexicon auto-detect (Feature 13 follow-up, owner decision 2026-10-07): the composer picks up
// lexicon terms the user types and shows them as "detected" chips. The message text is never
// changed. The user can dismiss any of them, and a dismissed term stays off for that draft.
import { activeTerms, findTerm, type Term, type TermVia, unavailableReason } from "@/shared/lexicon";
import { buildMatcher, findTerms, termKey, type TermMatcher } from "./terms";

/**
 * Forms that are never picked up from text, although the term still has them as aliases. "can"
 * opens most questions ("can you…") and would attach May to nearly every message.
 */
export const UNDETECTED_FORMS: ReadonlySet<string> = new Set(["can"]);

let cached: TermMatcher | null | undefined;

/** One whole-word pattern over every active term's name and aliases (reuses the definitions matcher). */
function matcher(): TermMatcher | null {
  if (cached !== undefined) return cached;
  const entries = activeTerms().flatMap((t) =>
    [t.name, ...t.aliases]
      .filter((form) => !UNDETECTED_FORMS.has(termKey(form)))
      .map((form) => ({ id: t.id, term: form, termKey: termKey(form) })),
  );
  cached = buildMatcher(entries);
  return cached;
}

/**
 * The lexicon terms named in `text`, each once, in the order they first appear. Whole words only,
 * any case; a typographic apostrophe counts as a straight one. No stemming: "tables" isn't "table".
 */
export function detectTerms(text: string): string[] {
  // Same length, so offsets stay valid.
  const normalized = text.replace(/[‘’]/g, "'");
  const ids: string[] = [];
  for (const m of findTerms(normalized, 0, matcher())) if (!ids.includes(m.defId)) ids.push(m.defId);
  return ids;
}

export type DraftChip = { id: string; via: TermVia };
export type Suggestion = { id: string; blockedBy: string[] };
/** Per-draft choices about detected terms. `pinned`: detected terms swapped in, which win over the rest. */
export type DraftLexicon = { dismissed: string[]; pinned: string[] };
export const EMPTY_DRAFT_LEXICON: DraftLexicon = { dismissed: [], pinned: [] };

/** The selected terms that stop `id` from being added (same single-value slot, or a declared conflict). */
function blockers(term: Term, accepted: readonly string[]): string[] {
  return accepted.filter((otherId) => unavailableReason(term.id, [otherId]) !== null);
}

/**
 * The chips a draft is sent with. Chips added by hand come first, then detected terms (pinned ones,
 * then text order). A detected term that clashes with one already chosen, by slot or a declared
 * conflict, isn't added: it becomes a suggestion the user can swap in.
 */
export function composeChips(manual: readonly string[], detected: readonly string[], draft: DraftLexicon): { chips: DraftChip[]; suggestions: Suggestion[] } {
  const chips: DraftChip[] = [];
  const suggestions: Suggestion[] = [];
  const accepted: string[] = [];
  for (const id of manual) {
    if (unavailableReason(id, accepted) !== null) continue;
    accepted.push(id);
    chips.push({ id, via: "chip" });
  }
  const order = [...draft.pinned.filter((id) => detected.includes(id)), ...detected.filter((id) => !draft.pinned.includes(id))];
  for (const id of order) {
    if (draft.dismissed.includes(id) || accepted.includes(id)) continue;
    const term = findTerm(id);
    if (!term || term.retired) continue;
    if (unavailableReason(id, accepted) === null) {
      accepted.push(id);
      chips.push({ id, via: "detected" });
    } else {
      suggestions.push({ id, blockedBy: blockers(term, accepted) });
    }
  }
  return { chips, suggestions };
}
