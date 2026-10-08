import { describe, expect, it } from "vitest";
import { findTerm, LEXICON_PREAMBLE, lexiconBlock, runCheck } from "@/shared/lexicon";
import { LEXICON_PREAMBLE as fromBlock } from "@/shared/lexicon/block";

const t = (id: string) => findTerm(id)!;

describe("the <lexicon> block (FR-012, FR-013)", () => {
  it("is null without terms", () => {
    expect(lexiconBlock([])).toBeNull();
  });

  it("lists exactly the given terms in slot order, then id, with their exact instructions", () => {
    const block = lexiconBlock([t("skeptic"), t("bulleted-list"), t("distill")])!;
    expect(block.split("\n")).toEqual([
      "<lexicon>",
      LEXICON_PREAMBLE,
      `<term id="distill" v="1" slot="operation">${t("distill").instruction}</term>`,
      `<term id="bulleted-list" v="1" slot="format">${t("bulleted-list").instruction}</term>`,
      `<term id="skeptic" v="1" slot="audience">${t("skeptic").instruction}</term>`,
      "</lexicon>",
    ]);
    expect(fromBlock).toBe(LEXICON_PREAMBLE);
    expect(LEXICON_PREAMBLE).toMatch(/precedence over the general length guidance/);
  });

  it("escapes quotes and markup so the block stays well formed", () => {
    const block = lexiconBlock([{ id: "x", version: 3, slot: "quality", instruction: 'Say "hi" & a < b' }])!;
    expect(block).toContain('<term id="x" v="3" slot="quality">Say &quot;hi&quot; &amp; a &lt; b</term>');
  });

  it("is deterministic: equal inputs in any order give equal blocks", () => {
    expect(lexiconBlock([t("must"), t("always"), t("table")])).toBe(lexiconBlock([t("table"), t("always"), t("must")]));
  });
});

describe("output checks (FR-020)", () => {
  const cases: Array<[string, string, string]> = [
    ["bulleted", "Intro:\n- one\n- two", "- one\nno"],
    ["numbered", "1. a\n2. b", "2. a\n3. b"],
    ["table", "| a | b |\n|---|---|\n| 1 | 2 |", "| a | b |\n| 1 | 2 |"],
    ["checklist", "- [ ] pack\n- [x] book", "- pack\n- book"],
    ["tldr-first", "TL;DR: yes.\n\nMore.", "Intro.\nTL;DR: yes."],
    ["pros-cons", "**Pros**\n- a\n\n**Cons**\n- b", "Cons\n- b\nPros\n- a"],
    ["one-page", "word ".repeat(400), "word ".repeat(520)],
    ["confidence", "Answer.\n\nConfidence: 7/10 — more data would help.", "Answer only."],
  ];
  for (const [check, pass, fail] of cases) {
    it(`${check} passes and fails on fixtures`, () => {
      expect(runCheck(check, pass)).toBe(true);
      expect(runCheck(check, fail)).toBe(false);
    });
  }
  it("refuses an unknown check", () => {
    expect(() => runCheck("nope", "x")).toThrow(/Unknown lexicon check/);
  });
});
