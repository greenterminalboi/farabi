import { describe, expect, it } from "vitest";
import { splitByMarkers } from "@/components/chat/markerRanges";

const m = (id: string, start: number, end: number) => ({
  id, start, end, messageId: "x", anchorText: "", childNodeId: `c-${id}`, kind: "selection" as const,
});

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
