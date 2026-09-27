import { describe, expect, it } from "vitest";
import { setFakeMode } from "@/server/ai/fake";
import { db } from "@/server/db/client";
import { call } from "./helpers";

async function newRoot() {
  const res = await call("POST", "/api/trees", {});
  expect(res.status).toBe(201);
  return res.body as { tree: { id: string }; node: { id: string } };
}

describe("US1 root conversations", () => {
  it("creates a root with no parent or anchor, leaving other trees unchanged", async () => {
    const first = await newRoot();
    const before = await call("GET", "/api/forest");
    const second = await newRoot();

    expect(second.node).toMatchObject({ parentId: null, anchorText: null, isRoot: true });
    expect(second.tree.id).not.toBe(first.tree.id);
    const after = await call("GET", "/api/forest");
    expect(after.body.trees).toHaveLength(2);
    const firstTreeBefore = before.body.trees.find((t: { id: string }) => t.id === first.tree.id);
    const firstTreeAfter = after.body.trees.find((t: { id: string }) => t.id === first.tree.id);
    expect(firstTreeAfter).toEqual(firstTreeBefore);
  });

  it("stores the user message and AI reply with provenance and consecutive seq", async () => {
    const { node } = await newRoot();
    const res = await call("POST", `/api/nodes/${node.id}/messages?wait=1`, { content: "Tell me about Pods" });
    expect(res.status).toBe(201);
    expect(res.body.userMessage).toMatchObject({ role: "user", provenance: "user_authored", seq: 1 });
    expect(res.body.aiMessage).toMatchObject({
      role: "ai",
      provenance: "ai_suggested",
      status: "complete",
      seq: 2,
    });
    const view = await call("GET", `/api/nodes/${node.id}`);
    expect(view.body.messages.map((m: { seq: number }) => m.seq)).toEqual([1, 2]);
  });

  it("rejects empty messages", async () => {
    const { node } = await newRoot();
    const res = await call("POST", `/api/nodes/${node.id}/messages?wait=1`, { content: "   " });
    expect(res.status).toBe(422);
  });

  it("keeps the user message when the AI is unavailable, and retry recovers", async () => {
    const { node } = await newRoot();
    setFakeMode({ mode: "fail" });
    const res = await call("POST", `/api/nodes/${node.id}/messages?wait=1`, { content: "hello" });
    // Sending is asynchronous since Feature 2: the message is stored and the reply ends failed.
    expect(res.status).toBe(201);
    expect(res.body.userMessage.content).toBe("hello");
    expect(res.body.aiMessage.status).toBe("failed");

    const view = await call("GET", `/api/nodes/${node.id}`);
    expect(view.body.messages.map((m: { status: string }) => m.status)).toEqual(["complete", "failed"]);

    setFakeMode({ mode: "ok" });
    const failedId = view.body.messages[1].id;
    const retry = await call("POST", `/api/messages/${failedId}/retry?wait=1`, {});
    expect(retry.status).toBe(201);
    expect(retry.body.aiMessage.status).toBe("complete");

    const failedRow = await db.selectFrom("messages").selectAll().where("id", "=", failedId).executeTakeFirstOrThrow();
    expect(failedRow.replaced_at).not.toBeNull();
    expect(failedRow.replaced_by).toBe(retry.body.aiMessage.id);
  });

  it("regenerates only the latest AI reply and keeps the replaced one", async () => {
    const { node } = await newRoot();
    const first = await call("POST", `/api/nodes/${node.id}/messages?wait=1`, { content: "one" });
    const second = await call("POST", `/api/nodes/${node.id}/messages?wait=1`, { content: "two" });

    const stale = await call("POST", `/api/messages/${first.body.aiMessage.id}/regenerate?wait=1`, {});
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("not_latest_ai_message");

    const view = await call("GET", `/api/nodes/${node.id}`);
    expect(view.body.canRegenerate).toEqual({ messageId: second.body.aiMessage.id });

    const regen = await call("POST", `/api/messages/${second.body.aiMessage.id}/regenerate?wait=1`, {});
    expect(regen.status).toBe(201);
    expect(regen.body.replaced.id).toBe(second.body.aiMessage.id);
    const old = await db
      .selectFrom("messages")
      .selectAll()
      .where("id", "=", second.body.aiMessage.id)
      .executeTakeFirstOrThrow();
    expect(old.replaced_at).not.toBeNull();
    expect(old.replaced_by).toBe(regen.body.aiMessage.id);

    const after = await call("GET", `/api/nodes/${node.id}`);
    expect(after.body.messages.map((m: { id: string }) => m.id)).not.toContain(second.body.aiMessage.id);
    expect(after.body.messages.at(-1).id).toBe(regen.body.aiMessage.id);
  });

  it("rejects requests from other origins", async () => {
    const res = await call("GET", "/api/forest", undefined, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("returns 404 for unknown nodes", async () => {
    expect((await call("GET", "/api/nodes/not-a-uuid")).status).toBe(404);
    expect((await call("GET", `/api/nodes/${crypto.randomUUID()}`)).status).toBe(404);
  });
});
