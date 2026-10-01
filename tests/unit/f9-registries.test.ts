import { describe, expect, it } from "vitest";
import { z } from "zod";
import { findKind, getKind, kindsWithSettings, registerKind } from "@/shared/kinds";
import { getFunction, listFunctionsFor, registerFunction } from "@/server/functions/definitions";
import { analogy } from "@/server/functions/definitions/analogy";
import { validateProperties } from "@/server/nodes/kinds";

describe("Feature 9 · kind and function registries", () => {
  it("registers the built-in kinds and Analogy", () => {
    expect(getKind("conversation").view).toBe("chat");
    expect(getKind("analogy").view).toBe("output_beside_input");
    expect(getKind("pipe").view).toBe("pipe");
    expect(kindsWithSettings().map((k) => k.id)).toEqual(["analogy"]);
    expect(getFunction("analogy").outputKind).toBe("analogy");
    expect(listFunctionsFor("conversation").map((f) => f.id)).toContain("analogy");
    expect(listFunctionsFor("analogy")).toEqual([]);
  });

  it("rejects bad kind declarations", () => {
    const base = { label: "X", conversationBacked: false, view: "pipe" as const, mapLabel: "none" as const, properties: z.object({}).strict() };
    expect(() => registerKind({ ...base, id: "analogy", settings: [] })).toThrow(/already registered/);
    expect(() =>
      registerKind({
        ...base,
        id: "bad-default",
        settings: [{ key: "k", label: "K", help: "", type: "choice", choices: [{ value: "a", label: "A" }], default: "b" }],
      }),
    ).toThrow(/default/);
    expect(findKind("bad-default")).toBeUndefined();
  });

  it("rejects a function whose output kind doesn't accept its inputs", () => {
    expect(() => registerFunction({ ...analogy, id: "pipe-maker", outputKind: "pipe" })).toThrow(/accept/);
    expect(() => registerFunction({ ...analogy, id: "nowhere", outputKind: "missing" })).toThrow(/unknown kind/);
  });

  it("rejects undeclared properties (FR-035)", () => {
    expect(validateProperties("analogy", {})).toEqual({});
    expect(() => validateProperties("analogy", { foo: 1 })).toThrow(/property/i);
  });
});
