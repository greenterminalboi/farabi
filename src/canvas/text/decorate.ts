// What a mounted element's text carries besides its words (FR-035): branch markers from its child
// edges' anchors (FR-018), underlines for collected terms (Feature 2) and, on complete answers,
// suggested places to branch: the reply's own bold text (Feature 5, FR-056).
import { findTerms, type TermMatcher } from "@/lib/terms";
import { type Marker, segmentAttributes, splitByMarkers } from "./markerRanges";
import type { Decorate } from "./render";

export type DecorationInput = {
  markers: Marker[];
  matcher: TermMatcher | null;
  /** Underline bold runs as suggestions: complete answers only, when suggestions are on. */
  suggestBold: boolean;
};

/** A decorator for one element, or null when it has nothing to decorate. */
export function makeDecorate({ markers, matcher, suggestBold }: DecorationInput): Decorate | null {
  if (markers.length === 0 && !matcher && !suggestBold) return null;
  return (run) => {
    const terms = findTerms(run.text, run.start, matcher);
    const suggestions = suggestBold && run.marks.includes("strong") ? [{ start: run.start, end: run.end }] : [];
    const mine = markers.filter((m) => m.start < run.end && m.end > run.start);
    if (mine.length === 0 && terms.length === 0 && suggestions.length === 0) return null;
    return splitByMarkers(run.start, run.end, mine, terms, suggestions).map((seg) => {
      const a = segmentAttributes(seg);
      const attrs: Record<string, string> = {};
      if (a.markers) attrs["data-markers"] = a.markers;
      if (a.defId) attrs["data-def-id"] = a.defId;
      if (a.suggest) attrs["data-suggest"] = a.suggest;
      return { start: seg.start, end: seg.end, className: a.className, attrs };
    });
  };
}

/** A key that changes when an element's decorations would, so its item re-renders (FR-035). */
export function decorationKey(input: DecorationInput, matcherVersion: number): string {
  return `${input.markers.map((m) => `${m.id}:${m.start}-${m.end}`).join(",")}|${input.matcher ? matcherVersion : 0}|${input.suggestBold ? 1 : 0}`;
}
