import { SLOT_ORDER, type Term } from "./types";

type BlockTerm = Pick<Term, "id" | "version" | "slot" | "instruction">;

/** The block's opening line (contracts/prompt.md). */
export const LEXICON_PREAMBLE =
  "The person attached these terms from their prompting lexicon to their latest message. They are the person's explicit request: apply each one as defined. Where a term sets the length or scope of the reply, it takes precedence over the general length guidance.";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The `<lexicon>` system block for a reply (FR-012, FR-013): only the given terms, in slot order and
 * then by id, each with its exact instruction. Null when there are none, so no block is sent.
 */
export function lexiconBlock(terms: readonly BlockTerm[]): string | null {
  if (terms.length === 0) return null;
  const sorted = [...terms].sort(
    (a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const lines = sorted.map((t) => `<term id="${escape(t.id)}" v="${t.version}" slot="${t.slot}">${escape(t.instruction)}</term>`);
  return ["<lexicon>", LEXICON_PREAMBLE, ...lines, "</lexicon>"].join("\n");
}
