import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { getFakeCalls, registerFakeCompletion, resetFakeCalls, setFakeMode } from "@/server/ai/fake";
import { AIUnavailableError } from "@/server/ai/provider";
import { callOperation, DRILL_OPERATIONS, drillLadder, drillOffer, drillRound, drillVerdict, resetDrillFakes } from "@/server/drill/operations";
import { extractJson } from "@/server/drill/operations/call";
import { normalizeProblem, rejectDuplicates, type RoundInput } from "@/server/drill/operations/round";

// Feature 12, research R4, R5, R8, R16: drill operations as data, run by one generic executor.

process.env.AI_PROVIDER = "fake";

const roundInput: RoundInput = {
  domain: "Python dictionaries",
  roundNumber: 2,
  ladder: [
    { id: "r1", name: "Add entries" },
    { id: "r2", name: "Look up values" },
  ],
  slots: [
    { rungIds: ["r2"], level: 1 },
    { rungIds: ["r1"], level: 4 },
  ],
  lessonRungIds: ["r2"],
  earlier: ["Problem r1-1 on Add entries L1"],
  mistakes: [],
  attachments: [],
};

beforeEach(() => {
  setFakeMode({ mode: "ok" });
  resetFakeCalls();
  resetDrillFakes();
});

describe("Feature 12 · drill operations", () => {
  it("extracts the first JSON object, ignoring fences, prose and braces in strings", () => {
    expect(extractJson('Sure!\n```json\n{"a": "x}y", "b": {"c": 1}}\n```\nmore {"d": 2}')).toEqual({ a: "x}y", b: { c: 1 } });
    expect(() => extractJson("no json here")).toThrow(SyntaxError);
  });

  it("calls the provider with the operation's tag, model, effort and token limit, and validates", async () => {
    const out = await callOperation(drillRound, roundInput, { model: "claude-x" });
    expect(out.problems.map((p) => p.text)).toEqual(["Problem r2-1 on Look up values L1", "Problem r2-2 on Add entries L4"]);
    expect(out.lessons).toEqual([{ rungId: "r2", text: expect.stringContaining("Look up values") }]);
    expect(getFakeCalls().lastComplete).toMatchObject({ tag: "drill_round", model: "claude-x", effort: "medium", maxTokens: 8000 });
  });

  it("retries once with the validation problem, then throws AIUnavailableError", async () => {
    let calls = 0;
    registerFakeCompletion("drill_verdict", () => (++calls === 1 ? '{"verdict": "maybe"}' : '{"verdict": "solved", "feedback": "ok"}'));
    const input = { domain: "d", rungNames: [], problem: "p", solution: "s", attempt: "a", hinted: false };
    expect(await callOperation(drillVerdict, input, { model: null })).toEqual({ verdict: "solved", feedback: "ok" });
    expect(getFakeCalls().completeInputs.at(-1)!.prompt).toContain("couldn't be used: verdict");

    registerFakeCompletion("drill_verdict", () => "not json");
    await expect(callOperation(drillVerdict, input, { model: null })).rejects.toBeInstanceOf(AIUnavailableError);
    setFakeMode({ mode: "fail" });
    await expect(callOperation(drillVerdict, input, { model: null })).rejects.toBeInstanceOf(AIUnavailableError);
  });

  it("checks each operation's output shape", () => {
    const ladder = drillLadder.output;
    expect(ladder.safeParse({ rungs: ["a"] }).success).toBe(true);
    expect(ladder.safeParse({ rungs: [] }).success).toBe(false);
    expect(ladder.safeParse({ rungs: Array(13).fill("x") }).success).toBe(false);
    expect(drillVerdict.output.safeParse({ verdict: "solved", feedback: "" }).success).toBe(false);

    const offerIn = { domain: "d", ladder: [], candidates: [{ nodeId: "n1", text: "t" }, { nodeId: "n2", text: "u" }] };
    const pick = (...ids: string[]) => ({ picks: ids.map((nodeId) => ({ nodeId, domain: "x" })) });
    expect(drillOffer.output.safeParse(pick("n1", "n2", "n1", "n2")).success).toBe(false);
    expect(drillOffer.check!(pick(), offerIn)).toBeNull();
    expect(drillOffer.check!(pick("n2"), offerIn)).toBeNull();
    expect(drillOffer.check!(pick("n3"), offerIn)).toMatch(/candidates/);
    expect(drillOffer.check!(pick("n1", "n1"), offerIn)).toMatch(/once/);

    const two = { text: "t", hint: "h", solution: "s" };
    expect(drillRound.check!({ lessons: [{ rungId: "r2", text: "l" }], problems: [two] }, roundInput)).toMatch(/exactly 2/);
    expect(drillRound.check!({ lessons: [], problems: [two, two] }, roundInput)).toMatch(/lesson/);
  });

  it("keeps the executor free of operation ids (FR-028)", () => {
    const source = readFileSync(path.resolve(import.meta.dirname, "../../src/server/drill/operations/call.ts"), "utf8");
    for (const op of DRILL_OPERATIONS) expect(source).not.toContain(op.id);
    expect(DRILL_OPERATIONS.map((o) => o.id)).toEqual(["drill_ladder", "drill_round", "drill_verdict", "drill_offer", "drill_domain"]);
  });

  it("rejects repeated problems by normalized text (R8)", () => {
    expect(normalizeProblem("  Add a KEY,  then:\nprint it!  ")).toBe("add a key then print it");
    const { kept, rejected } = rejectDuplicates(
      [{ text: "Add a key." }, { text: "add a KEY" }, { text: "Problem r1-1 on add entries, L1" }, { text: "New one" }],
      ["Problem r1-1 on Add entries L1"],
    );
    expect(kept.map((p) => p.text)).toEqual(["Add a key.", "New one"]);
    expect(rejected).toHaveLength(2);
  });
});
