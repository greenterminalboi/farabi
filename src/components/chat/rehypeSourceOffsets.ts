import { findTerms, type TermMatcher } from "@/lib/terms";
import type { Marker } from "@/shared/schemas";
import { segmentAttributes, splitByMarkers } from "./markerRanges";

// Minimal hast types (avoids a direct dependency on @types/hast).
type Position = { start: { offset?: number }; end: { offset?: number } };
type HastText = { type: "text"; value: string; position?: Position };
type HastElement = {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
  position?: Position;
};
type HastNode = HastText | HastElement | { type: string; children?: HastNode[] };

function segmentSpans(value: string, start: number, markers: Marker[], matcher: TermMatcher | null = null): HastElement[] {
  const terms = findTerms(value, start, matcher);
  return splitByMarkers(start, start + value.length, markers, terms).map((seg) => {
    const attrs = segmentAttributes(seg);
    const properties: Record<string, unknown> = { "data-start": seg.start, "data-end": seg.end };
    if (attrs.className) properties.className = attrs.className.split(" ");
    if (attrs.markers) properties["data-markers"] = attrs.markers;
    if (attrs.defId) properties["data-def-id"] = attrs.defId;
    return {
      type: "element",
      tagName: "span",
      properties,
      children: [{ type: "text", value: value.slice(seg.start - start, seg.end - start) }],
    };
  });
}

/**
 * Wraps every text node whose source offsets map 1:1 onto its text in
 * `<span data-start data-end>`, split at branch-marker boundaries. Text whose source differs from
 * its rendered value (escapes, entities, inline code) is left unwrapped and can't anchor a branch.
 */
export function rehypeSourceOffsets(options: { markers: Marker[]; matcher?: TermMatcher | null }) {
  const { markers, matcher = null } = options;
  return (tree: HastNode) => {
    const visit = (node: HastNode) => {
      if (!("children" in node) || !node.children) return;
      const next: HastNode[] = [];
      for (const child of node.children) {
        if (child.type === "text") {
          const text = child as HastText;
          const s = text.position?.start.offset;
          const e = text.position?.end.offset;
          if (s !== undefined && e !== undefined && e - s === text.value.length) {
            next.push(...segmentSpans(text.value, s, markers, matcher));
            continue;
          }
        } else {
          visit(child);
        }
        next.push(child);
      }
      node.children = next;
    };
    visit(tree);
  };
}

export { segmentSpans };
