import { describe, expect, it } from "vitest";
import { z } from "zod";
import { findKind, getKind, kindsWithSettings, registerKind } from "@/shared/kinds";
import { getFunction, listFunctionsFor, registerFunction } from "@/server/functions/definitions";
import { analogy } from "@/server/functions/definitions/analogy";
import { validateProperties } from "@/server/graph/elements";

// Kinds with shape and display, and functions on edges (contracts/declarations.md, FR-043–FR-054).

describe("Feature 10 · kind and function registries", () => {
  it("registers question, answer, function and analogy with their shapes and displays", () => {
    expect(getKind("question")).toMatchObject({ shape: "edge", display: "question" });
    expect(getKind("answer")).toMatchObject({ shape: "node", display: "answer" });
    expect(getKind("function")).toMatchObject({ shape: "edge", display: "function_connector" });
    expect(getKind("analogy")).toMatchObject({ shape: "node", display: "output", acceptsInputKinds: ["answer"] });
    expect(findKind("conversation")).toBeUndefined();
    expect(findKind("pipe")).toBeUndefined();
    expect(kindsWithSettings().map((k) => k.id)).toEqual(["analogy"]);
    expect(getFunction("analogy")).toMatchObject({ version: 2, accepts: ["answer"], reads: "text", outputKind: "analogy" });
    expect(listFunctionsFor("answer").map((f) => f.id)).toContain("analogy");
    expect(listFunctionsFor("analogy")).toEqual([]);
    expect(listFunctionsFor("question")).toEqual([]);
  });

  it("rejects bad kind declarations", () => {
    const base = { label: "X", shape: "node" as const, display: "output" as const, properties: z.object({}).strict() };
    expect(() => registerKind({ ...base, id: "analogy", settings: [] })).toThrow(/already registered/);
    expect(() =>
      registerKind({
        ...base,
        id: "bad-default",
        settings: [{ key: "k", label: "K", help: "", type: "choice", choices: [{ value: "a", label: "A" }], default: "b" }],
      }),
    ).toThrow(/default/);
    expect(() =>
      registerKind({
        ...base,
        id: "twice",
        settings: [
          { key: "k", label: "K", help: "", type: "choice", choices: [{ value: "a", label: "A" }], default: "a" },
          { key: "k", label: "K", help: "", type: "choice", choices: [{ value: "a", label: "A" }], default: "a" },
        ],
      }),
    ).toThrow(/twice/);
    // display must match shape: an output is drawn as a node, a question as an edge.
    expect(() => registerKind({ ...base, id: "edge-card", shape: "edge", settings: [] })).toThrow(/draws a node/);
    expect(() => registerKind({ ...base, id: "node-bubble", display: "question", settings: [] })).toThrow(/draws an edge/);
    for (const id of ["bad-default", "twice", "edge-card", "node-bubble"]) expect(findKind(id)).toBeUndefined();
  });

  it("rejects a function whose output kind isn't a node that accepts its inputs", () => {
    expect(() => registerFunction({ ...analogy, id: "to-answer", outputKind: "answer" })).toThrow(/accept/);
    expect(() => registerFunction({ ...analogy, id: "to-edge", outputKind: "question" })).toThrow(/must create a node/);
    expect(() => registerFunction({ ...analogy, id: "nowhere", outputKind: "missing" })).toThrow(/unknown kind/);
  });

  it("rejects undeclared properties (FR-054)", () => {
    expect(validateProperties("analogy", {})).toEqual({});
    expect(() => validateProperties("analogy", { foo: 1 })).toThrow(/property/i);
  });
});
