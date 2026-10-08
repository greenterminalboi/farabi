// Code checks for terms whose effect can be seen in the output (FR-020, research R9). They run on
// a reply's text with no AI call; live runs against a model are a follow-up.

const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim());
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

export const CHECKS: Record<string, (output: string) => boolean> = {
  /** At least two lines that are bullets (and not checkboxes). */
  bulleted: (o) => lines(o).filter((l) => /^[-*•]\s+(?!\[[ xX]\])\S/.test(l)).length >= 2,
  /** At least two numbered lines, starting from 1. */
  numbered: (o) => {
    const nums = lines(o)
      .map((l) => /^(\d+)[.)]\s+\S/.exec(l)?.[1])
      .filter((n): n is string => n !== undefined);
    return nums.length >= 2 && nums[0] === "1";
  },
  /** A markdown table: a header row followed by a separator row. */
  table: (o) => {
    const ls = lines(o);
    return ls.some((l, i) => /^\|.*\|$/.test(l) && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(ls[i + 1] ?? ""));
  },
  /** At least two markdown checkboxes. */
  checklist: (o) => lines(o).filter((l) => /^[-*]\s+\[[ xX]\]\s+\S/.test(l)).length >= 2,
  /** The first non-empty line starts with "TL;DR". */
  "tldr-first": (o) => /^\**TL;DR\**:?/i.test(lines(o).find((l) => l !== "") ?? ""),
  /** Both a "Pros" and a "Cons" heading or label, pros first. */
  "pros-cons": (o) => {
    const ls = lines(o).map((l) => l.replace(/^[#*\s]+|[*:\s]+$/g, "").toLowerCase());
    const pros = ls.findIndex((l) => l === "pros" || l.startsWith("pros "));
    const cons = ls.findIndex((l) => l === "cons" || l.startsWith("cons "));
    return pros !== -1 && cons > pros;
  },
  /** Fits a page: at most 500 words (the instruction asks for about 450). */
  "one-page": (o) => words(o) > 0 && words(o) <= 500,
  /** Ends with a 1–10 confidence rating. */
  confidence: (o) => {
    const tail = lines(o).filter(Boolean).slice(-3).join(" ");
    return /confidence[^0-9]{0,40}\b([1-9]|10)\s*(\/\s*10|out of 10)?\b/i.test(tail);
  },
};

/** Runs a named check; throws for an unknown check id. */
export function runCheck(checkId: string, output: string): boolean {
  const check = CHECKS[checkId];
  if (!check) throw new Error(`Unknown lexicon check "${checkId}"`);
  return check(output);
}
