import { describe, expect, it } from "vitest";
import { buildHeadlessReply, buildReplyRequest, lengthGuidance, REPLY_SYSTEM } from "@/server/ai/claudePrompts";
import type { ReplyInput } from "@/server/ai/provider";
import { findTerm, lexiconBlock } from "@/shared/lexicon";

const base: ReplyInput = {
  inheritedContext: [],
  anchorText: null,
  messages: [{ role: "user", content: "What did the paper find?" }],
  pressureLevel: 3,
  model: null,
};
const terms = ["table", "distill"].map((id) => {
  const t = findTerm(id)!;
  return { id: t.id, version: t.version, slot: t.slot, instruction: t.instruction };
});

describe("the lexicon block in the reply prompt (FR-012, contracts/prompt.md)", () => {
  it("without terms, the request is exactly as before", () => {
    const { system, messages } = buildReplyRequest(base);
    expect(system.map((b) => b.text)).toEqual([REPLY_SYSTEM, lengthGuidance(3)]);
    expect(buildReplyRequest({ ...base, lexicon: [] }).system).toEqual(system);
    expect(messages).toEqual([{ role: "user", content: "What did the paper find?" }]);
  });

  it("with terms, the block is the last system block and the messages are unchanged", () => {
    const { system, messages } = buildReplyRequest({ ...base, anchorText: "a passage", lexicon: terms });
    expect(system).toHaveLength(4);
    expect(system[0].text).toBe(REPLY_SYSTEM);
    expect(system[3].text).toBe(lexiconBlock(terms));
    expect(system[3].text.indexOf('id="distill"')).toBeLessThan(system[3].text.indexOf('id="table"'));
    expect(messages).toEqual([{ role: "user", content: "What did the paper find?" }]);
  });

  it("Claude Code headless mode receives the same block", () => {
    const { system, prompt } = buildHeadlessReply({ ...base, lexicon: terms });
    expect(system).toContain(lexiconBlock(terms)!);
    expect(prompt).toContain("What did the paper find?");
    expect(prompt).not.toContain("<lexicon>");
  });
});
