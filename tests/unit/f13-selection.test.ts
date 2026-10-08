import { describe, expect, it } from "vitest";
import { checkSelection, LexiconUses, searchTerms, sortBySlot, unavailableReason } from "@/shared/lexicon";

describe("lexicon selection rules (FR-002, FR-007, FR-008)", () => {
  it("one term per single slot", () => {
    expect(unavailableReason("comprehensive", ["concise"])).toBe("Scope already set: Concise");
    expect(unavailableReason("table", ["bulleted-list"])).toBe("Format already set: Bulleted list");
    expect(unavailableReason("summarize", ["distill"])).toBe("Operation already set: Distill");
    expect(unavailableReason("eli5", ["expert-level"])).toBe("Audience already set: Expert-level");
    expect(unavailableReason("formal", ["neutral"])).toBe("Tone already set: Neutral");
  });

  it("strength and quality take several terms", () => {
    expect(unavailableReason("never", ["must", "only"])).toBeNull();
    expect(unavailableReason("edge-cases", ["think-first", "self-critique"])).toBeNull();
  });

  it("declared conflicts block in both directions", () => {
    expect(unavailableReason("comprehensive", ["distill"])).toBe("Conflicts with Distill");
    expect(unavailableReason("distill", ["comprehensive"])).toBe("Conflicts with Comprehensive");
    expect(unavailableReason("simplify", ["verbatim"])).toBe("Conflicts with Verbatim");
  });

  it("no count limit (owner decision 2026-10-07), no duplicates, no unknown terms", () => {
    const ten = ["distill", "concise", "table", "direct", "skeptic", "must", "never", "only", "edge-cases", "think-first"];
    expect(checkSelection(ten).ok).toBe(true);
    expect(unavailableReason("always", ten)).toBeNull();
    expect(LexiconUses.safeParse(ten.map((id) => ({ id, v: 1 }))).success).toBe(true);
    expect(checkSelection(["table", "table"])).toEqual({ ok: false, reason: "Table: Already added" });
    expect(checkSelection(["nope"])).toEqual({ ok: false, reason: 'Unknown term "nope"' });
    expect(checkSelection(["concise", "comprehensive"])).toEqual({ ok: false, reason: "Comprehensive: Scope already set: Concise" });
  });

  it("accepted selections come back in slot order", () => {
    const res = checkSelection(["must", "table", "distill", "always"]);
    expect(res.ok && res.terms.map((t) => t.id)).toEqual(["distill", "table", "always", "must"]);
    expect(sortBySlot([{ id: "b", slot: "tone" as const }, { id: "a", slot: "operation" as const }]).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("search matches names and aliases, prefixes first", () => {
    expect(searchTerms("dist")[0].id).toBe("distill");
    expect(searchTerms("elaborate").map((t) => t.id)).toEqual(["expand"]);
    expect(searchTerms("CLASSIFY").map((t) => t.id)).toEqual(["categorize"]);
    expect(searchTerms("lis").map((t) => t.id).slice(0, 2)).toEqual(["bulleted-list", "numbered-list"]);
    expect(searchTerms("").length).toBeGreaterThanOrEqual(65);
  });
});
