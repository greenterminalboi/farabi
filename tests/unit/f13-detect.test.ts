import { describe, expect, it } from "vitest";
import { composeChips, detectTerms, EMPTY_DRAFT_LEXICON, UNDETECTED_FORMS } from "@/lib/lexiconDetect";
import { activeTerms, LexiconUses, TermUse } from "@/shared/lexicon";

describe("lexicon auto-detect (owner decision 2026-10-07)", () => {
  it("finds names and aliases as whole words, any case, in text order", () => {
    expect(detectTerms("Summarize this as a TABLE")).toEqual(["summarize", "table"]);
    expect(detectTerms("give me bullet points, be blunt")).toEqual(["bulleted-list", "direct"]);
    expect(detectTerms("Steel man the other side")).toEqual(["steelman"]);
    expect(detectTerms("explain like i'm 5 please")).toEqual(["eli5"]);
  });

  it("ignores words inside other words", () => {
    expect(detectTerms("the comparable tablet is outdrafted")).toEqual([]);
    expect(detectTerms("onlyness mustard alwaysish")).toEqual([]);
    expect(detectTerms("ranking abstractions")).toEqual([]);
  });

  it("no stemming: plurals and other inflections aren't the term", () => {
    expect(detectTerms("two tables and three drafts")).toEqual([]);
    expect(detectTerms("she summarized it")).toEqual([]);
  });

  it("handles punctuation around and inside forms", () => {
    expect(detectTerms("(concise), please.")).toEqual(["concise"]);
    expect(detectTerms("TL;DR: what happened?")).toEqual(["tldr"]);
    expect(detectTerms("list the pros/cons")).toEqual(["pros-and-cons"]);
    expect(detectTerms("make it step-by-step")).toEqual(["numbered-list"]);
    expect(detectTerms("“Formal” tone")).toEqual(["formal"]);
  });

  it("treats a typographic apostrophe like a straight one", () => {
    expect(detectTerms("explain like i’m 5")).toEqual(["eli5"]);
  });

  it("prefers the longest form at a position", () => {
    // "non-expert" is Layperson; its "expert" isn't also Expert-level.
    expect(detectTerms("for a non-expert")).toEqual(["layperson"]);
    expect(detectTerms("critique yourself afterwards")).toEqual(["self-critique"]);
    expect(detectTerms("bottom line up front")).toEqual(["bluf"]);
  });

  it("records each term once, at its first appearance", () => {
    expect(detectTerms("must do X, must do Y, required: Z")).toEqual(["must"]);
  });

  it("never picks up the excluded everyday forms", () => {
    expect([...UNDETECTED_FORMS].every((f) => activeTerms().some((t) => t.aliases.map((a) => a.toLowerCase()).includes(f)))).toBe(true);
    expect(detectTerms("Can you help?")).toEqual([]);
    expect(detectTerms("you may skip it")).toEqual(["may"]);
  });

  it("an empty or term-free text finds nothing", () => {
    expect(detectTerms("")).toEqual([]);
    expect(detectTerms("What is a monad?")).toEqual([]);
  });
});

describe("composing a draft's chips", () => {
  const none = EMPTY_DRAFT_LEXICON;

  it("hand-added chips come first, then detected ones", () => {
    expect(composeChips(["table"], ["summarize", "table"], none).chips).toEqual([
      { id: "table", via: "chip" },
      { id: "summarize", via: "detected" },
    ]);
  });

  it("keeps the first term in text order for a single slot and suggests the other", () => {
    const res = composeChips([], ["formal", "conversational", "must"], none);
    expect(res.chips).toEqual([
      { id: "formal", via: "detected" },
      { id: "must", via: "detected" },
    ]);
    expect(res.suggestions).toEqual([{ id: "conversational", blockedBy: ["formal"] }]);
  });

  it("a declared conflict becomes a suggestion too, and a chip beats a detected term", () => {
    const res = composeChips(["verbatim"], ["simplify"], none);
    expect(res.chips).toEqual([{ id: "verbatim", via: "chip" }]);
    expect(res.suggestions).toEqual([{ id: "simplify", blockedBy: ["verbatim"] }]);
  });

  it("dismissed terms stay off while the word stays in the text", () => {
    const res = composeChips([], ["summarize", "table"], { dismissed: ["table"], pinned: [] });
    expect(res.chips).toEqual([{ id: "summarize", via: "detected" }]);
    expect(res.suggestions).toEqual([]);
  });

  it("a swapped-in (pinned) suggestion wins over earlier detected terms", () => {
    const draft = { dismissed: ["formal"], pinned: ["direct"] };
    const res = composeChips([], ["formal", "conversational", "direct"], draft);
    expect(res.chips).toEqual([{ id: "direct", via: "detected" }]);
    expect(res.suggestions).toEqual([{ id: "conversational", blockedBy: ["direct"] }]);
  });

  it("a pinned term whose word left the text is gone", () => {
    expect(composeChips([], ["formal"], { dismissed: [], pinned: ["direct"] }).chips).toEqual([{ id: "formal", via: "detected" }]);
  });

  it("there is no count limit", () => {
    const ids = ["summarize", "concise", "table", "formal", "skeptic", "must", "never", "only", "always", "edge-cases"];
    expect(composeChips([], ids, none).chips).toHaveLength(10);
  });
});

describe("recorded uses (via)", () => {
  it("via is optional and limited to detected or chip", () => {
    expect(TermUse.safeParse({ id: "table", v: 1 }).success).toBe(true);
    expect(TermUse.safeParse({ id: "table", v: 1, via: "detected" }).success).toBe(true);
    expect(TermUse.safeParse({ id: "table", v: 1, via: "chip" }).success).toBe(true);
    expect(TermUse.safeParse({ id: "table", v: 1, via: "guessed" }).success).toBe(false);
    expect(LexiconUses.safeParse([{ id: "table", v: 1, via: "chip" }, { id: "must", v: 1 }]).success).toBe(true);
  });
});
