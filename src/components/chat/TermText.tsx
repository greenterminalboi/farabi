import { findTerms, type TermMatcher } from "@/lib/terms";
import { splitByMarkers } from "./markerRanges";

/** Plain text with collected terms underlined; no offsets, for read-only text (FR-036a). */
export function TermText({ text, matcher }: { text: string; matcher: TermMatcher | null }) {
  const segments = splitByMarkers(0, text.length, [], findTerms(text, 0, matcher));
  return (
    <>
      {segments.map((seg) =>
        seg.defId ? (
          <span key={seg.start} className="term-mark" data-def-id={seg.defId} tabIndex={0}>
            {text.slice(seg.start, seg.end)}
          </span>
        ) : (
          <span key={seg.start}>{text.slice(seg.start, seg.end)}</span>
        ),
      )}
    </>
  );
}
