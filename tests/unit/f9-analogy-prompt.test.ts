import { describe, expect, it } from "vitest";
import { AIUnavailableError } from "@/server/ai/provider";
import { analogy } from "@/server/functions/definitions/analogy";

describe("Feature 9 · Analogy instruction", () => {
  it("states the reach and length it was given", () => {
    const phrases = {
      close: "neighbouring field",
      everyday: "everyday life",
      far: "distant, surprising domain",
    };
    for (const [reach, phrase] of Object.entries(phrases)) {
      expect(analogy.instruction.system({ reach, length: "short" })).toContain(phrase);
    }
    const lengths = { one_line: "Write one sentence", short: "two or three sentences", paragraph: "120 words" };
    for (const [length, phrase] of Object.entries(lengths)) {
      expect(analogy.instruction.system({ reach: "everyday", length })).toContain(phrase);
    }
  });

  it("keeps claims to the summary (Article III)", () => {
    expect(analogy.instruction.system({ reach: "everyday", length: "short" })).toMatch(/must come from the summary/);
  });

  it("wraps the escaped summary", () => {
    expect(analogy.instruction.prompt({ text: "a < b" }, {})).toContain("<summary>\na &lt; b\n</summary>");
  });

  it("cleans the answer and refuses an empty one", () => {
    expect(analogy.parse('  "Like a  library\n card."  ')).toBe("Like a library card.");
    expect(() => analogy.parse(' "" ')).toThrow(AIUnavailableError);
  });
});
