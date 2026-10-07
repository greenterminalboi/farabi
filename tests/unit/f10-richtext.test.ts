import { describe, expect, it } from "vitest";
import { clip, parseRichText, plainRichText, previewRichText, richTextFor } from "@/canvas/text/richText";

const runsOf = (source: string) => parseRichText(source).blocks.flatMap((b) => b.runs);

describe("parseRichText", () => {
  it("maps every run with offsets back to exactly its source text", () => {
    const source = [
      "# Pods and *containers*",
      "",
      "A **pod** wraps one or more containers, see `kubectl`.",
      "",
      "- first item",
      "- second **bold** item",
      "  1. nested",
      "",
      "> quoted text",
      "",
      "Escaped \\* star and &amp; entity.",
    ].join("\n");
    const runs = runsOf(source);
    expect(runs.length).toBeGreaterThan(5);
    for (const run of runs) {
      if (run.start === null) continue;
      expect(source.slice(run.start, run.end!)).toBe(run.text);
    }
  });

  it("finds block structure and marks", () => {
    const { blocks } = parseRichText("## Title\n\nSome **bold** and _em_.\n\n- a\n- b\n\n```\ncode\n```");
    expect(blocks.map((b) => b.tag)).toEqual(["h2", "p", "li", "li", "pre"]);
    const para = blocks[1].runs;
    expect(para.find((r) => r.text === "bold")?.marks).toEqual(["strong"]);
    expect(para.find((r) => r.text === "em")?.marks).toEqual(["em"]);
  });

  it("leaves inline code, escapes and entities unmapped", () => {
    const runs = runsOf("Use `x` and \\* and &amp;.");
    expect(runs.find((r) => r.text === "x")?.start).toBeNull();
    expect(runs.find((r) => r.text === "&")?.start ?? null).toBeNull();
  });

  it("numbers ordered list items and tracks nesting", () => {
    const { blocks } = parseRichText("3. three\n4. four\n   - inner");
    expect(blocks.map((b) => [b.tag, b.depth, b.ordered])).toEqual([
      ["li", 1, 3],
      ["li", 1, 4],
      ["li", 2, undefined],
    ]);
  });
});

describe("plainRichText", () => {
  it("maps every character of a user's message, line by line", () => {
    const source = "first line\n\nthird line";
    const rich = plainRichText(source);
    expect(rich.blocks).toHaveLength(3);
    for (const run of rich.blocks.flatMap((b) => b.runs)) expect(source.slice(run.start!, run.end!)).toBe(run.text);
  });
});

describe("clip", () => {
  const source = "One two three four five.\n\nSecond paragraph here.\n\nThird.";
  const rich = parseRichText(source);

  it("returns everything when it fits", () => {
    const c = clip(rich, 10_000);
    expect(c.clipped).toBe(false);
    expect(c.chars).toBe(rich.chars);
  });

  it("never exceeds the budget and cuts at a word boundary", () => {
    for (const budget of [1, 5, 10, 13, 24, 30, 40]) {
      const c = clip(rich, budget);
      expect(c.clipped).toBe(true);
      expect(c.chars).toBeLessThanOrEqual(budget);
      const last = c.blocks.flatMap((b) => b.runs).at(-1);
      // A cut run stops just before a space in the source, or at the end of its own text.
      if (last?.end != null && budget > 3) expect([" ", "\n", ""]).toContain(source.charAt(last.end));
    }
    expect(clip(rich, 12).blocks[0].runs[0].text).toBe("One two");
  });

  it("keeps offsets of the clipped run consistent", () => {
    const source = "Alpha beta gamma delta";
    const c = clip(parseRichText(source), 12);
    const run = c.blocks[0].runs[0];
    expect(source.slice(run.start!, run.end!)).toBe(run.text);
  });
});

describe("richTextFor", () => {
  it("caches by id and re-parses when a streaming text grows", () => {
    const a = richTextFor("n1", "Hello", true);
    expect(richTextFor("n1", "Hello", true)).toBe(a);
    expect(richTextFor("n1", "Hello there", true)).not.toBe(a);
  });
});

describe("previewRichText", () => {
  it("skips markdown syntax and keeps every shown character mapped", () => {
    const source = "## The **pod** is `small`\n\nMore text.";
    const rich = previewRichText(source, 10);
    const runs = rich.blocks[0].runs;
    expect(runs.map((r) => r.text).join("")).toBe("The pod is small");
    for (const r of runs) expect(source.slice(r.start!, r.end!)).toBe(r.text);
  });

  it("starts at the first non-empty line and stops at its end", () => {
    const rich = previewRichText("\n\n- first item\n- second", 50);
    expect(rich.blocks[0].runs.map((r) => r.text).join("")).toBe("first item");
  });
});
