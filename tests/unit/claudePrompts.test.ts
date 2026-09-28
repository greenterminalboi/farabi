import { describe, expect, it } from "vitest";
import {
  buildReplyRequest,
  buildSummaryRequest,
  cleanSummary,
  parseSpans,
  REPLY_SYSTEM,
} from "@/server/ai/claudePrompts";

describe("buildReplyRequest", () => {
  it("sends a root conversation as plain turns with the stable system prompt only", () => {
    const req = buildReplyRequest({
      inheritedContext: [],
      anchorText: null,
      pressureLevel: null,
      model: null,
      messages: [
        { role: "user", content: "What is a Pod?" },
        { role: "ai", content: "A group of containers." },
        { role: "user", content: "Why group them?" },
      ],
    });
    expect(req.system).toEqual([{ type: "text", text: REPLY_SYSTEM }]);
    expect(req.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("puts a branch's inherited context and anchor in a second system block", () => {
    const req = buildReplyRequest({
      inheritedContext: [
        { role: "user", content: "Tell me about Pods" },
        { role: "ai", content: "Pods run <containers>." },
      ],
      anchorText: "containers",
      pressureLevel: null,
      model: null,
      messages: [{ role: "user", content: "What is a container?" }],
    });
    expect(req.system[0].text).toBe(REPLY_SYSTEM); // cacheable prefix unchanged
    const context = req.system[1].text;
    expect(context).toContain("<earlier_conversation>");
    expect(context).toContain('speaker="person"');
    expect(context).toContain("Pods run &lt;containers&gt;.");
    expect(context).toContain("<highlighted_passage>\ncontainers\n</highlighted_passage>");
    expect(req.messages).toEqual([{ role: "user", content: "What is a container?" }]);
  });

  it("rejects conversations that don't end with the person's message", () => {
    expect(() =>
      buildReplyRequest({
        inheritedContext: [],
        anchorText: null,
        pressureLevel: null,
        model: null,
        messages: [{ role: "ai", content: "hi" }],
      }),
    ).toThrow();
  });
});

describe("buildSummaryRequest", () => {
  it("includes only the node's own messages and its anchor", () => {
    const req = buildSummaryRequest({
      anchorText: "leader election",
      messages: [{ role: "user", content: "Raft vs Paxos?" }],
    });
    const content = req.messages[0].content as string;
    expect(content).toContain("<started_from_highlighted_passage>\nleader election");
    expect(content).toContain("Raft vs Paxos?");
  });
});

describe("cleanSummary", () => {
  it("keeps one clean line", () => {
    expect(cleanSummary('  "Raft and Paxos trade  simplicity for flexibility."\nExtra')).toBe(
      "Raft and Paxos trade simplicity for flexibility.",
    );
  });
});

describe("buildHeadlessReply", () => {
  it("sends the conversation as a transcript with the reply instructions in the system prompt", async () => {
    const { buildHeadlessReply } = await import("@/server/ai/claudePrompts");
    const { system, prompt } = buildHeadlessReply({
      inheritedContext: [{ role: "user", content: "Pods?" }],
      anchorText: "Pods",
      pressureLevel: null,
      model: null,
      messages: [
        { role: "user", content: "first" },
        { role: "ai", content: "answer" },
        { role: "user", content: "second" },
      ],
    });
    expect(system.startsWith(REPLY_SYSTEM)).toBe(true);
    expect(system).toContain("<highlighted_passage>");
    expect(system).toContain("Write only your next reply");
    expect(prompt).toContain('<turn speaker="assistant">\nanswer\n</turn>');
    expect(prompt.trim().endsWith("second\n</turn>\n</conversation>")).toBe(true);
  });
});

describe("parseSpans", () => {
  it("keeps SPAN lines, trimmed and unquoted", () => {
    expect(parseSpans('SPAN: control plane\nSPAN:  "storage volumes" \n')).toEqual(["control plane", "storage volumes"]);
  });

  it("treats NONE and empty output as no suggestions", () => {
    expect(parseSpans("NONE")).toEqual([]);
    expect(parseSpans("   ")).toEqual([]);
  });

  it("throws on output in neither form", () => {
    expect(() => parseSpans("Here are some ideas you might like")).toThrow();
  });
});
