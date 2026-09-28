import { describe, expect, it } from "vitest";
import {
  buildDefineRequest,
  buildHeadlessReply,
  buildReplyRequest,
  buildSummaryRequest,
  lengthGuidance,
  REPLY_SYSTEM,
} from "@/server/ai/claudePrompts";
import type { ReplyInput } from "@/server/ai/provider";

const CLOSING = "Match this length unless the person explicitly asks for a different length in their message.";
const levels = Array.from({ length: 10 }, (_, i) => i + 1);

const input = (pressureLevel: number | null, anchorText: string | null = null): ReplyInput => ({
  inheritedContext: anchorText ? [{ role: "user", content: "earlier" }] : [],
  anchorText,
  messages: [{ role: "user", content: "What is a Pod?" }],
  pressureLevel,
  model: null,
});

describe("lengthGuidance", () => {
  it("gives ten distinct instructions that defer to the person's explicit request", () => {
    const texts = levels.map(lengthGuidance);
    expect(new Set(texts).size).toBe(10);
    for (const t of texts) expect(t.endsWith(CLOSING)).toBe(true);
  });
});

describe("reply requests carry the level (Feature 6)", () => {
  it("adds the guidance as the last system block, after the branch context", () => {
    const root = buildReplyRequest(input(3));
    expect(root.system.map((b) => b.text)).toEqual([REPLY_SYSTEM, lengthGuidance(3)]);
    const branch = buildReplyRequest(input(3, "containers"));
    expect(branch.system).toHaveLength(3);
    expect(branch.system[2].text).toBe(lengthGuidance(3));
  });

  it("adds nothing without a level", () => {
    expect(buildReplyRequest(input(null)).system.map((b) => b.text)).toEqual([REPLY_SYSTEM]);
  });

  it("includes the guidance in the Claude Code form", () => {
    expect(buildHeadlessReply(input(9)).system).toContain(lengthGuidance(9));
  });
});

describe("nothing else carries a level (FR-007, SC-005)", () => {
  it("summary and definition requests never contain length guidance", () => {
    const outputs = [
      JSON.stringify(buildSummaryRequest({ anchorText: null, messages: [{ role: "ai", content: "Pods group containers." }] })),
      JSON.stringify(
        buildDefineRequest({ term: "Pod", sourceMessage: { role: "ai", content: "A Pod." }, messages: [{ role: "ai", content: "A Pod." }] }),
      ),
    ];
    for (const out of outputs) {
      expect(out).not.toContain(CLOSING);
      for (const level of levels) expect(out).not.toContain(lengthGuidance(level).split(" Match")[0]);
    }
  });
});
