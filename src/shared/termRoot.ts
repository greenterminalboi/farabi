import { termKey } from "./termKey";

/**
 * A rough word root, so the Definitions tab can show related terms together ("reductionist",
 * "reductionism" and "reductive" all give "reduct"). It only groups entries for display; each
 * definition stays its own entry (no merging, Constitution Article II).
 *
 * Suffixes are stripped repeatedly, longest first, while at least MIN_STEM letters remain.
 * Prefixes are stripped only when hyphenated ("anti-realism" → "realism"), since an unhyphenated
 * "re", "meta" or "non" is too often part of the word itself.
 */
const SUFFIXES = [
  "isations", "izations", "isation", "ization", "ations", "ation", "ists", "isms", "ities", "ness",
  "ments", "ment", "ings", "ical", "ally", "ives", "ism", "ist", "ity", "ive", "ize", "ise",
  "ing", "ion", "ers", "ics", "ies", "al", "ic", "er", "ed", "ly", "es", "s", "y",
].sort((a, b) => b.length - a.length);

const MIN_STEM = 4;

function stemWord(word: string): string {
  const unprefixed = word.replace(/^[a-z]+-(?=[a-z]{3,})/, "");
  let stem = unprefixed;
  for (let changed = true; changed; ) {
    changed = false;
    for (const suffix of SUFFIXES) {
      if (stem.endsWith(suffix) && stem.length - suffix.length >= MIN_STEM) {
        stem = stem.slice(0, -suffix.length);
        changed = true;
        break;
      }
    }
  }
  return stem;
}

export function termRoot(term: string): string {
  return termKey(term)
    .split(" ")
    .map(stemWord)
    .join(" ");
}
