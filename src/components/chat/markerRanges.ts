import type { Marker } from "@/shared/schemas";

export type Segment = { start: number; end: number; markers: Marker[] };

/**
 * Splits [start, end) at every marker boundary inside it. Each segment lists the markers covering
 * it, so overlapping markers render as layered highlights (research R6).
 */
export function splitByMarkers(start: number, end: number, markers: Marker[]): Segment[] {
  const cuts = new Set<number>([start, end]);
  for (const m of markers) {
    if (m.start > start && m.start < end) cuts.add(m.start);
    if (m.end > start && m.end < end) cuts.add(m.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const s = points[i];
    const e = points[i + 1];
    segments.push({ start: s, end: e, markers: markers.filter((m) => m.start < e && m.end > s) });
  }
  return segments;
}
