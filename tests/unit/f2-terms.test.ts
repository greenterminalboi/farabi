import { describe, expect, it } from "vitest";
import { splitByMarkers } from "@/canvas/text/markerRanges";
import { buildMatcher, findTerms, termKey } from "@/lib/terms";
import { parseDefinition } from "@/server/ai/claudePrompts";

const index = (...terms: string[]) => terms.map((t, i) => ({ id: `d${i}`, term: t, termKey: termKey(t) }));

describe("termKey", () => {
  it("ignores case, outer and repeated spaces", () => {
    expect(termKey("  Control   Plane ")).toBe("control plane");
    expect(termKey("control plane")).toBe(termKey("CONTROL PLANE"));
  });
});

describe("term matching", () => {
  it("matches whole words only, any case or spacing", () => {
    const m = buildMatcher(index("pod", "control plane"));
    const found = findTerms("A Pod, podcast, and the Control  plane.", 0, m);
    expect(found.map((f) => [f.start, f.end, f.defId])).toEqual([
      [2, 5, "d0"],
      [24, 38, "d1"],
    ]);
  });

  it("prefers the longest term where terms overlap", () => {
    const m = buildMatcher(index("plane", "control plane"));
    const found = findTerms("the control plane and a plane", 0, m);
    expect(found.map((f) => f.defId)).toEqual(["d1", "d0"]);
  });

  it("keeps raw offsets when combined with branch markers", () => {
    const m = buildMatcher(index("pods"));
    const text = "Pods run containers";
    const terms = findTerms(text, 100, m);
    const marker = { id: "m", messageId: "x", start: 102, end: 108, anchorText: "", childNodeId: "c", kind: "selection" as const };
    const segs = splitByMarkers(100, 100 + text.length, [marker], terms);
    expect(segs.map((s) => [s.start, s.end, s.defId, s.markers.length])).toEqual([
      [100, 102, "d0", 0],
      [102, 104, "d0", 1],
      [104, 108, null, 1],
      [108, 119, null, 0],
    ]);
  });

  it("returns nothing without collected terms", () => {
    expect(buildMatcher([])).toBeNull();
    expect(findTerms("anything", 0, null)).toEqual([]);
  });
});

describe("parseDefinition", () => {
  it("reads the two labelled parts", () => {
    expect(parseDefinition("GENERAL: A unit of work.\nIN THIS CONVERSATION: The Pod example.")).toEqual({
      general: "A unit of work.",
      usage: "The Pod example.",
    });
  });

  it("rejects replies without both parts", () => {
    expect(() => parseDefinition("Just a sentence.")).toThrow();
  });
});
