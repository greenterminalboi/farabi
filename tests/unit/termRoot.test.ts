import { describe, expect, it } from "vitest";
import { termRoot } from "@/shared/termRoot";

describe("termRoot", () => {
  it("groups words that differ only by suffix", () => {
    const root = termRoot("reductionism");
    expect(termRoot("Reductionist")).toBe(root);
    expect(termRoot("reductionists")).toBe(root);
    expect(termRoot("reduction")).toBe(root);
    expect(termRoot("reductive")).toBe(root);
    expect(termRoot("empiricism")).toBe(termRoot("empiricist"));
    expect(termRoot("Idealism")).toBe(termRoot("idealist"));
  });

  it("strips hyphenated prefixes only", () => {
    expect(termRoot("anti-realism")).toBe(termRoot("realist"));
    expect(termRoot("non-reductive")).toBe(termRoot("reductionism"));
    // An unhyphenated prefix is part of the word.
    expect(termRoot("metaphysics")).not.toBe(termRoot("physics"));
  });

  it("keeps unrelated and short words apart", () => {
    expect(termRoot("realism")).not.toBe(termRoot("reductionism"));
    expect(termRoot("pods")).not.toBe(termRoot("pod racing"));
    expect(termRoot("is")).toBe("is");
  });

  it("works word by word in phrases", () => {
    expect(termRoot("Logical empiricism")).toBe(termRoot("logical empiricist"));
  });
});
