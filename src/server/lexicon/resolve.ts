// Server side of the lexicon (Feature 13, contracts/http-api.md): checking the chips a message was
// sent with, and turning recorded uses back into the instructions a reply is given.
import { checkSelection, findTerm, LexiconUses, type Term, type TermUse, type TermVia } from "@/shared/lexicon";
import type { TermInput } from "@/shared/schemas";
import { InvalidRequestError } from "../errors";

/**
 * Checks a message's terms (FR-008: single-value slots and declared conflicts; no count limit) and
 * returns the uses to record, each with how it arrived, or undefined when there are none. A bare id
 * is a chip added by hand.
 */
export function resolveTerms(input: readonly TermInput[] | undefined): TermUse[] | undefined {
  if (!input || input.length === 0) return undefined;
  const via = new Map<string, TermVia>();
  const ids = input.map((t) => {
    const [id, how]: [string, TermVia] = typeof t === "string" ? [t, "chip"] : [t.id, t.via];
    if (!via.has(id)) via.set(id, how);
    return id;
  });
  const res = checkSelection(ids);
  if (!res.ok) throw new InvalidRequestError(res.reason);
  return res.terms.map((t) => ({ id: t.id, v: t.version, via: via.get(t.id)! }));
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
  // How a term arrived belongs to the question; the answer records only what it was sent.
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
