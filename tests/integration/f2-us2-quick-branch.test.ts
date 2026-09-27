import { describe, expect, it } from "vitest";
import { getFakeCalls } from "@/server/ai/fake";
import { db } from "@/server/db/client";
import { drainGenerations } from "@/server/messages/generation";
import { call, sendAndWait } from "./helpers";

async function root() {
  return (await call("POST", "/api/trees", {})).body.node.id as string;
}

const allReplyText = () =>
  getFakeCalls()
    .replyInputs.flatMap((i) => [...i.messages, ...i.inheritedContext].map((m) => m.content))
    .join("\n");

describe("Feature 2 · US2 quick branch", () => {
  it("branches from the user's last message and resends it in the new branch", async () => {
    const nodeId = await root();
    await sendAndWait(nodeId, "What is a sidecar?");
    const res = await call("POST", `/api/nodes/${nodeId}/messages`, { content: "????" });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("quick_branch");
    expect(res.body.node.parentId).toBe(nodeId);
    expect(res.body.marker.kind).toBe("whole_message");
    expect(res.body.marker.anchorText).toBe("What is a sidecar?");
    expect(res.body.marker.start).toBe(0);
    expect(res.body.marker.end).toBe("What is a sidecar?".length);
    expect(res.body.userMessage.content).toBe("What is a sidecar?");
    await drainGenerations();

    const child = await call("GET", `/api/nodes/${res.body.node.id}`);
    expect(child.body.messages.map((m: { content: string }) => m.content)[0]).toBe("What is a sidecar?");
    expect(child.body.messages[1].status).toBe("complete");
    // The anchored message isn't repeated in the inherited context (FR-011).
    const inherited = child.body.inheritedContext.flatMap((e: { messages: { content: string }[] }) =>
      e.messages.map((m) => m.content),
    );
    expect(inherited).not.toContain("What is a sidecar?");

    const parent = await call("GET", `/api/nodes/${nodeId}`);
    expect(parent.body.messages.map((m: { content: string }) => m.content)).not.toContain("????");
    expect(allReplyText()).not.toContain("????");
  });

  it("keeps earlier parent messages as inherited context", async () => {
    const nodeId = await root();
    await sendAndWait(nodeId, "first topic");
    await sendAndWait(nodeId, "second question");
    const res = await call("POST", `/api/nodes/${nodeId}/messages`, { content: "????" });
    await drainGenerations();
    const child = await call("GET", `/api/nodes/${res.body.node.id}`);
    const inherited = child.body.inheritedContext[0].messages.map((m: { content: string }) => m.content);
    expect(inherited[0]).toBe("first topic");
    expect(inherited).not.toContain("second question");
    expect(getFakeCalls().lastReply!.inheritedContext.map((t) => t.content)).not.toContain("second question");
  });

  it("anchors to the latest user message even before its reply exists", async () => {
    const nodeId = await root();
    const sent = await call("POST", `/api/nodes/${nodeId}/messages`, { content: "mid reply" });
    await drainGenerations();
    expect(sent.body.userMessage.content).toBe("mid reply");
    const res = await call("POST", `/api/nodes/${nodeId}/messages`, { content: "  ????  " });
    expect(res.body.kind).toBe("quick_branch");
    expect(res.body.marker.anchorText).toBe("mid reply");
  });

  it("falls back to an ordinary message when there is nothing (new) to branch from", async () => {
    const nodeId = await root();
    const first = await sendAndWait(nodeId, "????");
    expect(first.body.kind).toBe("message");
    expect(first.body.userMessage.content).toBe("????");

    const other = await root();
    await sendAndWait(other, "anchor me");
    const a = await call("POST", `/api/nodes/${other}/messages`, { content: "????" });
    expect(a.body.kind).toBe("quick_branch");
    await drainGenerations();
    const b = await sendAndWait(other, "????");
    expect(b.body.kind).toBe("message");

    const c = await sendAndWait(other, "does this mean ????");
    expect(c.body.kind).toBe("message");
    const markers = await db.selectFrom("branch_markers").selectAll().where("kind", "=", "whole_message").execute();
    expect(markers).toHaveLength(1);
  });
});
