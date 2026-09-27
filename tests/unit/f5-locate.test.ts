import { describe, expect, it } from "vitest";
import { locateSpans } from "@/server/suggestions/locate";

const content =
  "Pods group containers. They share a network namespace and storage volumes. Scheduling is handled by the control plane.";

describe("locateSpans", () => {
  it("finds exact phrases at their first occurrence", () => {
    const spans = locateSpans(content, ["share a network namespace"]);
    expect(spans).toEqual([{ start: content.indexOf("share a network"), end: content.indexOf("share a network") + 25, text: "share a network namespace" }]);
    for (const s of spans) expect(content.slice(s.start, s.end)).toBe(s.text);
    const twice = "a b. a b.";
    expect(locateSpans(twice, ["a b."])[0].start).toBe(0);
  });

  it("drops paraphrases", () => {
    expect(locateSpans(content, ["shares one network namespace"])).toEqual([]);
  });

  it("enforces word and length limits", () => {
    expect(locateSpans("Pods everywhere", ["Pods"])).toEqual([]);
    const long = Array.from({ length: 21 }, (_, i) => `w${i}`).join(" ");
    expect(locateSpans(long, [long])).toEqual([]);
    const wide = `${"x".repeat(150)} ${"y".repeat(60)}`;
    expect(locateSpans(wide, [wide])).toEqual([]);
  });

  it("drops markdown characters and line breaks", () => {
    const md = "Use **bold words** here and `code bits` there\nnext line";
    expect(locateSpans(md, ["**bold words**", "`code bits` there", "there\nnext line", "Use **bold"])).toEqual([]);
    expect(locateSpans("see [the docs](x) now", ["[the docs](x) now"])).toEqual([]);
  });

  it("drops a phrase overlapping one already kept", () => {
    const spans = locateSpans(content, ["network namespace and storage", "share a network namespace"]);
    expect(spans.map((s) => s.text)).toEqual(["share a network namespace"]);
  });

  it("keeps at most 3, in text order", () => {
    const text = "one two. three four. five six. seven eight. nine ten.";
    const spans = locateSpans(text, ["nine ten.", "one two.", "five six.", "three four.", "seven eight."]);
    expect(spans.map((s) => s.text)).toEqual(["one two.", "three four.", "five six."]);
  });
});
