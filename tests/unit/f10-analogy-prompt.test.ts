import { describe, expect, it } from "vitest";
import { AIUnavailableError } from "@/server/ai/provider";
import { analogy } from "@/server/functions/definitions/analogy";

describe("Feature 10 · Analogy v2 instruction", () => {
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

  it("reads an answer's text and keeps claims to it (Article III)", () => {
    expect(analogy).toMatchObject({ version: 2, accepts: ["answer"], reads: "text", edgeKind: "function" });
    const system = analogy.instruction.system({ reach: "everyday", length: "short" });
    expect(system).toContain("an AI answer from the person's own conversation");
    expect(system).toMatch(/must come from the text/);
  });

  it("wraps the escaped text", () => {
    expect(analogy.instruction.prompt({ text: "a < b" }, {})).toContain("<text>\na &lt; b\n</text>");
  });

  it("cleans the answer and refuses an empty one", () => {
    expect(analogy.parse('  "Like a  library\n card."  ')).toBe("Like a library card.");
    expect(() => analogy.parse(' "" ')).toThrow(AIUnavailableError);
  });
});
