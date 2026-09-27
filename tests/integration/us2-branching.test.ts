import { describe, expect, it } from "vitest";
import { getFakeCalls } from "@/server/ai/fake";
import { call } from "./helpers";

async function rootWithReply(content = "Tell me about Pods") {
  const { body } = await call("POST", "/api/trees", {});
  const msg = await call("POST", `/api/nodes/${body.node.id}/messages`, { content });
  return { nodeId: body.node.id as string, treeId: body.tree.id as string, ai: msg.body.aiMessage };
}

function anchorFor(message: { id: string; content: string }, phrase: string, occurrence = 0) {
  let start = -1;
  for (let i = 0; i <= occurrence; i++) start = message.content.indexOf(phrase, start + 1);
  const end = start + phrase.length;
  return {
    messageId: message.id,
    start,
    end,
    text: phrase,
    prefix: message.content.slice(Math.max(0, start - 32), start),
    suffix: message.content.slice(end, end + 32),
  };
}

describe("US2 branching", () => {
  it("creates a child in the same tree with an exact marker", async () => {
    const { nodeId, treeId, ai } = await rootWithReply();
    const res = await call("POST", `/api/nodes/${nodeId}/branches`, anchorFor(ai, "Containers"));
    expect(res.status).toBe(201);
    expect(res.body.node).toMatchObject({ treeId, parentId: nodeId, isRoot: false, anchorText: "Containers" });
    expect(res.body.marker.anchorText).toBe(ai.content.slice(res.body.marker.start, res.body.marker.end));

    const parent = await call("GET", `/api/nodes/${nodeId}`);
    expect(parent.body.markers).toHaveLength(1);
    expect(parent.body.markers[0].childNodeId).toBe(res.body.node.id);
    const child = await call("GET", `/api/nodes/${res.body.node.id}`);
    expect(child.body.messages).toEqual([]); // waits for the user (FR-004)
    expect(child.body.anchor.text).toBe("Containers");
  });

  it("rejects invalid selections", async () => {
    const { nodeId, ai } = await rootWithReply();
    const other = await rootWithReply("other");
    const good = anchorFor(ai, "Containers");
    const cases = [
      { ...good, text: " ", start: ai.content.indexOf(" "), end: ai.content.indexOf(" ") + 1 },
      { ...good, end: ai.content.length + 5 },
      { ...good, text: "Different" },
      { ...anchorFor(other.ai, "Containers") },
    ];
    for (const body of cases) {
      const res = await call("POST", `/api/nodes/${nodeId}/branches`, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
  });

  it("refuses to branch from replaced messages", async () => {
    const { nodeId, ai } = await rootWithReply();
    await call("POST", `/api/messages/${ai.id}/regenerate`, {});
    const res = await call("POST", `/api/nodes/${nodeId}/branches`, anchorFor(ai, "Containers"));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("message_not_branchable");
  });

  it("supports overlapping branches and multi-level branching", async () => {
    const { nodeId, ai } = await rootWithReply();
    const a = await call("POST", `/api/nodes/${nodeId}/branches`, anchorFor(ai, "Containers are"));
    const b = await call("POST", `/api/nodes/${nodeId}/branches`, anchorFor(ai, "are mentioned"));
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.node.id).not.toBe(b.body.node.id);
    const parent = await call("GET", `/api/nodes/${nodeId}`);
    expect(parent.body.markers).toHaveLength(2);

    const childMsg = await call("POST", `/api/nodes/${a.body.node.id}/messages`, { content: "go deeper" });
    const grand = await call(
      "POST",
      `/api/nodes/${a.body.node.id}/branches`,
      anchorFor(childMsg.body.aiMessage, "deeper"),
    );
    expect(grand.status).toBe(201);
    expect(grand.body.node.parentId).toBe(a.body.node.id);
  });

  it("gives a branch the parent context up to the branch point only", async () => {
    const { nodeId, ai } = await rootWithReply("first question");
    const branch = await call("POST", `/api/nodes/${nodeId}/branches`, anchorFor(ai, "Containers"));
    const childId = branch.body.node.id;
    await call("POST", `/api/nodes/${nodeId}/messages`, { content: "parent continues later" });

    const child = await call("GET", `/api/nodes/${childId}`);
    expect(child.body.inheritedContext).toHaveLength(1);
    const inherited = child.body.inheritedContext[0].messages.map((m: { content: string }) => m.content);
    expect(inherited).toEqual(["first question", ai.content]);

    await call("POST", `/api/nodes/${childId}/messages`, { content: "child question" });
    const input = getFakeCalls().lastReply!;
    expect(input.anchorText).toBe("Containers");
    expect(input.inheritedContext.map((t) => t.content)).toEqual(["first question", ai.content]);
    expect(input.messages.map((t) => t.content)).toEqual(["child question"]);

    const parent = await call("GET", `/api/nodes/${nodeId}`);
    const parentContents = parent.body.messages.map((m: { content: string }) => m.content);
    expect(parentContents).not.toContain("child question");
  });

  it("builds inherited context across three levels", async () => {
    const { nodeId, ai } = await rootWithReply("root q");
    const b1 = await call("POST", `/api/nodes/${nodeId}/branches`, anchorFor(ai, "Containers"));
    const c1 = await call("POST", `/api/nodes/${b1.body.node.id}/messages`, { content: "child q" });
    await call("POST", `/api/nodes/${b1.body.node.id}/messages`, { content: "child later" });
    const b2 = await call(
      "POST",
      `/api/nodes/${b1.body.node.id}/branches`,
      anchorFor(c1.body.aiMessage, "child q"),
    );
    const view = await call("GET", `/api/nodes/${b2.body.node.id}`);
    expect(view.body.inheritedContext.map((e: { nodeId: string }) => e.nodeId)).toEqual([
      nodeId,
      b1.body.node.id,
    ]);
    const second = view.body.inheritedContext[1].messages.map((m: { content: string }) => m.content);
    expect(second).toEqual(["child q", c1.body.aiMessage.content]);
  });

  it("blocks regenerating a reply that has branches", async () => {
    const { nodeId, ai } = await rootWithReply();
    await call("POST", `/api/nodes/${nodeId}/branches`, anchorFor(ai, "Containers"));
    const view = await call("GET", `/api/nodes/${nodeId}`);
    expect(view.body.canRegenerate).toBeNull();
    const res = await call("POST", `/api/messages/${ai.id}/regenerate`, {});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("has_branches");
  });
});
