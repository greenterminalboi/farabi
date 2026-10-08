// The lexicon registry (Feature 13, contracts/registry.md). The terms are repo data, one JSON file
// per slot; this module validates them on load and holds the selection rules shared by the
// composer and the server. Adding a term means adding an entry to its slot's file.
import audience from "./data/audience.json";
import format from "./data/format.json";
import operation from "./data/operation.json";
import quality from "./data/quality.json";
import scope from "./data/scope.json";
import strength from "./data/strength.json";
import tone from "./data/tone.json";
import { MAX_TERMS, SINGLE_SLOTS, SLOT_LABEL, SLOT_ORDER, type Slot, Term } from "./types";

export { LEXICON_PREAMBLE, lexiconBlock } from "./block";
export { CHECKS, runCheck } from "./checks";
export * from "./types";

/** The data files, by the slot each one holds. */
export const DATA: Record<Slot, unknown[]> = { operation, scope, format, tone, audience, strength, quality };

function load(): Term[] {
  const terms: Term[] = [];
  for (const slot of SLOT_ORDER) {
    for (const [i, raw] of DATA[slot].entries()) {
      const parsed = Term.safeParse(raw);
      if (!parsed.success) throw new Error(`Lexicon ${slot}.json entry ${i}: ${parsed.error.message}`);
      if (parsed.data.slot !== slot) throw new Error(`Lexicon term "${parsed.data.id}" is in ${slot}.json but declares slot ${parsed.data.slot}`);
      terms.push(parsed.data);
    }
  }
  return terms;
}

const TERMS = load();
const BY_ID = new Map<string, Term>();
for (const t of TERMS) {
  if (BY_ID.has(t.id)) throw new Error(`Lexicon term "${t.id}" is declared twice`);
  BY_ID.set(t.id, t);
}

/** Every term, retired ones included, in slot order and then file order. */
export function allTerms(): Term[] {
  return TERMS;
}

/** Terms that can be added to a new message. */
export function activeTerms(): Term[] {
  return TERMS.filter((t) => !t.retired);
}

export function findTerm(id: string): Term | undefined {
  return BY_ID.get(id);
}

export function roleOf(term: Pick<Term, "slot">): "operation" | "modifier" {
  return term.slot === "operation" ? "operation" : "modifier";
}

/** Slot order, then id, so equal selections give equal prompts and chip rows. */
export function sortBySlot<T extends Pick<Term, "id" | "slot">>(terms: T[]): T[] {
  return [...terms].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Matches names and aliases, case-insensitively: terms whose name or an alias starts with the query
 * come first, then those containing it, each in registry order. An empty query matches everything.
 */
export function searchTerms(query: string, among: Term[] = activeTerms()): Term[] {
  const q = query.trim().toLowerCase();
  if (!q) return among;
  const forms = (t: Term) => [t.name, ...t.aliases].map((s) => s.toLowerCase());
  const prefix = among.filter((t) => forms(t).some((f) => f.startsWith(q) || f.split(/[\s/-]+/).some((w) => w.startsWith(q))));
  const rest = among.filter((t) => !prefix.includes(t) && forms(t).some((f) => f.includes(q)));
  return [...prefix, ...rest];
}

/** Why `id` can't be added next to `selected`, or null when it can (FR-007, FR-008). */
export function unavailableReason(id: string, selected: readonly string[]): string | null {
  const term = BY_ID.get(id);
  if (!term) return "Unknown term";
  if (term.retired) return "Retired";
  if (selected.includes(id)) return "Already added";
  if (selected.length >= MAX_TERMS) return `${MAX_TERMS} terms at most`;
  for (const otherId of selected) {
    const other = BY_ID.get(otherId);
    if (!other) continue;
    if (SINGLE_SLOTS.has(term.slot) && other.slot === term.slot) return `${SLOT_LABEL[term.slot]} already set: ${other.name}`;
    if (term.conflicts.includes(other.id) || other.conflicts.includes(term.id)) return `Conflicts with ${other.name}`;
  }
  return null;
}

/** Checks a whole selection in order; the first problem is the reason (FR-008). */
export function checkSelection(ids: readonly string[]): { ok: true; terms: Term[] } | { ok: false; reason: string } {
  const accepted: string[] = [];
  for (const id of ids) {
    const reason = unavailableReason(id, accepted);
    if (reason) {
      const name = BY_ID.get(id)?.name ?? id;
      return { ok: false, reason: reason === "Unknown term" ? `Unknown term "${id}"` : `${name}: ${reason}` };
    }
    accepted.push(id);
  }
  return { ok: true, terms: sortBySlot(accepted.map((id) => BY_ID.get(id)!)) };
}
