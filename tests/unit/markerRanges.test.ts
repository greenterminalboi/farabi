import { describe, expect, it } from "vitest";
import { segmentAttributes, splitByMarkers } from "@/canvas/text/markerRanges";

const m = (id: string, start: number, end: number) => ({ id, start, end });

describe("splitByMarkers", () => {
  it("splits overlapping markers into layered segments", () => {
    const segs = splitByMarkers(0, 20, [m("a", 2, 10), m("b", 6, 14)]);
    expect(segs.map((s) => [s.start, s.end, s.markers.map((x) => x.id).join("")])).toEqual([
      [0, 2, ""],
      [2, 6, "a"],
      [6, 10, "ab"],
      [10, 14, "b"],
      [14, 20, ""],
    ]);
  });
});

describe("suggested spans (Feature 5)", () => {
  it("cuts at suggestion edges and flags the covered segments", () => {
    const segs = splitByMarkers(0, 20, [m("a", 0, 6)], [{ start: 8, end: 10, defId: "d" }], [
      { start: 4, end: 12 },
    ]);
    expect(segs.map((s) => [s.start, s.end, s.suggestion ? `${s.suggestion.start}-${s.suggestion.end}` : null])).toEqual([
      [0, 4, null],
      [4, 6, "4-12"],
      [6, 8, "4-12"],
      [8, 10, "4-12"],
      [10, 12, "4-12"],
      [12, 20, null],
    ]);
  });

  it("layers suggest-mark with marker and term classes, carrying the whole span's offsets", () => {
    const [, withMarker, , withTerm] = splitByMarkers(0, 20, [m("a", 0, 6)], [{ start: 8, end: 10, defId: "d" }], [
      { start: 4, end: 12 },
    ]);
    expect(segmentAttributes(withMarker)).toEqual({
      className: "marker depth-1 suggest-mark",
      markers: "a",
      defId: undefined,
      suggest: "4-12",
    });
    expect(segmentAttributes(withTerm)).toMatchObject({ className: "term-mark suggest-mark", defId: "d", suggest: "4-12" });
    expect(segmentAttributes(splitByMarkers(0, 3, [])[0]).suggest).toBeUndefined();
  });
});
