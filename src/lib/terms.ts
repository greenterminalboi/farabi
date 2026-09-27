import type { TermIndexEntry } from "@/shared/schemas";
import { termKey } from "@/shared/termKey";

export { termKey };

export type TermMatcher = { regex: RegExp; idByKey: Map<string, string> };
export type TermMatch = { start: number; end: number; defId: string };

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One pattern for all collected terms (research R9): whole words only, any case or spacing,
 * longest terms first so "control plane" wins over "plane".
 */
export function buildMatcher(terms: TermIndexEntry[]): TermMatcher | null {
  if (terms.length === 0) return null;
  const keys = [...new Set(terms.map((t) => t.termKey))].sort((a, b) => b.length - a.length);
  const alternatives = keys.map((k) => k.split(" ").map(escapeRegex).join("\\s+"));
  const regex = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}])`, "giu");
  return { regex, idByKey: new Map(terms.map((t) => [t.termKey, t.id])) };
}

/** Term matches in `text`, with offsets shifted by `offset` (the text's raw start). */
export function findTerms(text: string, offset: number, matcher: TermMatcher | null): TermMatch[] {
  if (!matcher) return [];
  const out: TermMatch[] = [];
  matcher.regex.lastIndex = 0;
  for (const m of text.matchAll(matcher.regex)) {
    const defId = matcher.idByKey.get(termKey(m[0]));
    if (defId) out.push({ start: offset + m.index!, end: offset + m.index! + m[0].length, defId });
  }
  return out;
}
