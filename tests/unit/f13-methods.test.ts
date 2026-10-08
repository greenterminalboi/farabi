import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getFunction, listFunctionsFor } from "@/server/functions/definitions";
import { getKind } from "@/shared/kinds";

const METHODS = ["premortem", "steelman", "scqa"];

describe("lexicon methods as functions (FR-017, FR-018)", () => {
  it("each is a v1 function on answers with its own output kind", () => {
    for (const id of METHODS) {
      expect(getFunction(id)).toMatchObject({ id, version: 1, accepts: ["answer"], reads: "text", outputKind: id, edgeKind: "function", procedure: "propose" });
      expect(getKind(id)).toMatchObject({ shape: "node", display: "output", acceptsInputKinds: ["answer"], settings: [] });
    }
    expect(listFunctionsFor("answer").map((f) => f.id)).toEqual(["analogy", ...METHODS]);
    expect(listFunctionsFor("question")).toEqual([]);
  });

  it("prompts are grounded in the answer's text, which is escaped", () => {
    for (const id of METHODS) {
      const def = getFunction(id);
      expect(def.instruction.system({})).toMatch(/Every claim about its subject must come from that text/);
      expect(def.instruction.prompt({ text: "a <b> c" }, {})).toContain("<text>\na &lt;b&gt; c\n</text>");
    }
  });

  it("parse trims and refuses empty output", () => {
    for (const id of METHODS) {
      expect(getFunction(id).parse("  1. A risk  \n")).toBe("1. A risk");
      expect(() => getFunction(id).parse("  ")).toThrow(/empty/);
    }
  });

  it("the runner names none of them (SC-013)", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "../../src/server/functions/runner.ts"), "utf8");
    for (const id of METHODS) expect(src).not.toMatch(new RegExp(`["'\`]${id}["'\`]`));
  });
});
