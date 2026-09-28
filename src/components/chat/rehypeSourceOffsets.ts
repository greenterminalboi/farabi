import { findTerms, type TermMatcher } from "@/lib/terms";
import type { Marker } from "@/shared/schemas";
import { segmentAttributes, splitByMarkers, type SuggestedSpan } from "./markerRanges";

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

function segmentSpans(
  value: string,
  start: number,
  markers: Marker[],
  matcher: TermMatcher | null = null,
  suggestions: SuggestedSpan[] = [],
): HastElement[] {
  const terms = findTerms(value, start, matcher);
  return splitByMarkers(start, start + value.length, markers, terms, suggestions).map((seg) => {
    const attrs = segmentAttributes(seg);
    const properties: Record<string, unknown> = { "data-start": seg.start, "data-end": seg.end };
    if (attrs.className) properties.className = attrs.className.split(" ");
    if (attrs.markers) properties["data-markers"] = attrs.markers;
    if (attrs.defId) properties["data-def-id"] = attrs.defId;
    if (attrs.suggest) properties["data-suggest"] = attrs.suggest;
    return {
      type: "element",
      tagName: "span",
      properties,
      children: [{ type: "text", value: value.slice(seg.start - start, seg.end - start) }],
    };
  });
}

/** Bold in Markdown: `**text**` and `__text__` both render as <strong>. */
const BOLD_TAGS = new Set(["strong", "b"]);

/**
 * Wraps every text node whose source offsets map 1:1 onto its text in
 * `<span data-start data-end>`, split at branch-marker boundaries. Text whose source differs from
 * its rendered value (escapes, entities, inline code) is left unwrapped and can't anchor a branch.
 * With `underlineBold`, each such text inside bold is a suggested place to branch (Feature 5), marked
 * the same way as markers and terms. Nothing is asked of the AI.
 */
export function rehypeSourceOffsets(options: {
  markers: Marker[];
  matcher?: TermMatcher | null;
  underlineBold?: boolean;
}) {
  const { markers, matcher = null, underlineBold = false } = options;
  return (tree: HastNode) => {
    const visit = (node: HastNode, inBold: boolean) => {
      if (!("children" in node) || !node.children) return;
      const next: HastNode[] = [];
      for (const child of node.children) {
        if (child.type === "text") {
          const text = child as HastText;
          const s = text.position?.start.offset;
          const e = text.position?.end.offset;
          if (s !== undefined && e !== undefined && e - s === text.value.length) {
            const suggestions: SuggestedSpan[] = inBold && underlineBold && text.value.trim() ? [{ start: s, end: e }] : [];
            next.push(...segmentSpans(text.value, s, markers, matcher, suggestions));
            continue;
          }
        } else {
          const el = child as HastElement;
          visit(child, inBold || (el.type === "element" && BOLD_TAGS.has(el.tagName)));
        }
        next.push(child);
      }
      node.children = next;
    };
    visit(tree, false);
  };
}

export { segmentSpans };
