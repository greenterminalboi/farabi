import type { TermMatch } from "@/lib/terms";
import type { Marker, SuggestedSpan } from "@/shared/schemas";

export type Segment = {
  start: number;
  end: number;
  markers: Marker[];
  defId: string | null;
  /** The suggested span covering this segment, if any (Feature 5). */
  suggestion: { start: number; end: number } | null;
};

/**
 * Splits [start, end) at every marker and collected-term boundary inside it. Each segment lists
 * the markers covering it (overlapping markers render as layered highlights, research R6) and the
 * definition it belongs to, if any (Feature 2, FR-036a), and the suggested span covering it, if
 * any (Feature 5).
 */
export function splitByMarkers(
  start: number,
  end: number,
  markers: Marker[],
  terms: TermMatch[] = [],
  suggestions: SuggestedSpan[] = [],
): Segment[] {
  const cuts = new Set<number>([start, end]);
  for (const r of [...markers, ...terms, ...suggestions]) {
    if (r.start > start && r.start < end) cuts.add(r.start);
    if (r.end > start && r.end < end) cuts.add(r.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const s = points[i];
    const e = points[i + 1];
    segments.push({
      start: s,
      end: e,
      markers: markers.filter((m) => m.start < e && m.end > s),
      defId: terms.find((t) => t.start < e && t.end > s)?.defId ?? null,
      suggestion: suggestions.find((x) => x.start < e && x.end > s) ?? null,
    });
  }
  return segments;
}

/** Class and data attributes for a segment's span. */
export function segmentAttributes(seg: Segment): {
  className?: string;
  markers?: string;
  defId?: string;
  suggest?: string;
} {
  const classes: string[] = [];
  if (seg.markers.length) classes.push("marker", seg.markers.length > 1 ? "depth-2" : "depth-1");
  if (seg.defId) classes.push("term-mark");
  if (seg.suggestion) classes.push("suggest-mark");
  return {
    className: classes.length ? classes.join(" ") : undefined,
    markers: seg.markers.length ? seg.markers.map((m) => m.id).join(" ") : undefined,
    defId: seg.defId ?? undefined,
    suggest: seg.suggestion ? `${seg.suggestion.start}-${seg.suggestion.end}` : undefined,
  };
}
