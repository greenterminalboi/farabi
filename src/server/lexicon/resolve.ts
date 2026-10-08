// Server side of the lexicon (Feature 13, contracts/http-api.md): checking the chips a message was
// sent with, and turning recorded uses back into the instructions a reply is given.
import { checkSelection, findTerm, LexiconUses, type Term, type TermUse } from "@/shared/lexicon";
import { InvalidRequestError } from "../errors";

/** Checks a message's term ids (FR-008); the uses to record, or undefined when there are none. */
export function resolveTerms(ids: readonly string[] | undefined): TermUse[] | undefined {
  if (!ids || ids.length === 0) return undefined;
  const res = checkSelection(ids);
  if (!res.ok) throw new InvalidRequestError(res.reason);
  return res.terms.map((t) => ({ id: t.id, v: t.version }));
}

/** The `lexicon` property to store, or nothing (properties stay `{}` without terms). */
export function lexiconProperties(uses: readonly TermUse[] | undefined): { lexicon?: TermUse[] } {
  return uses && uses.length > 0 ? { lexicon: [...uses] } : {};
}

/** The uses recorded in an element's properties; empty when absent or unreadable. */
export function usesOf(properties: Record<string, unknown> | null | undefined): TermUse[] {
  const parsed = LexiconUses.safeParse(properties?.lexicon);
  return parsed.success ? parsed.data : [];
}

/**
 * What a new reply to an edge is sent (FR-014): the edge's term ids at their current versions.
 * A term no longer in the registry can't be sent, so it is left out.
 */
export function currentUses(edgeUses: readonly TermUse[]): TermUse[] {
  return edgeUses.flatMap((u) => {
    const term = findTerm(u.id);
    return term ? [{ id: term.id, v: term.version }] : [];
  });
}

/** The terms behind recorded uses, for the reply's lexicon block. */
export function termsOf(uses: readonly TermUse[]): Term[] {
  return uses.flatMap((u) => {
    const term = findTerm(u.id);
    return term ? [term] : [];
  });
}
