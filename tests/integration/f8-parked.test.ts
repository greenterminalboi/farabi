import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { setFakeMode } from "@/server/ai/fake";
import { db } from "@/server/db/client";
import { drainGenerations } from "@/server/messages/generation";
import { call, sendAndWait } from "./helpers";

type Msg = { id: string; content: string; role: string; status: string };

async function root() {
  return (await call("POST", "/api/trees", {})).body.node.id as string;
}

/** A root conversation with one complete AI reply, and a valid anchor on "Containers" in it. */
async function withReply() {
  const nodeId = await root();
  const ai: Msg = (await sendAndWait(nodeId, "Pods")).body.aiMessage;
  const start = ai.content.indexOf("Containers");
  const anchor = { messageId: ai.id, start, end: start + 10, text: "Containers", prefix: "", suffix: "" };
  return { nodeId, ai, anchor };
}

const count = async (table: "nodes" | "branch_markers" | "messages") =>
  (await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.table(table)}`.execute(db)).rows[0].n;

const view = async (nodeId: string) => (await call("GET", `/api/nodes/${nodeId}`)).body;

describe("Feature 8 · US1 park", () => {
  it("parks without creating a node, branch or message", async () => {
    const { nodeId, anchor } = await withReply();
    const before = [await count("nodes"), await count("branch_markers"), await count("messages")];
    const res = await call("POST", `/api/nodes/${nodeId}/parked`, anchor);
    expect(res.status).toBe(201);
    expect(res.body.parked.question).toBeNull();
    expect(res.body.parked.anchor).toMatchObject({ messageId: anchor.messageId, start: anchor.start, text: "Containers" });
    expect([await count("nodes"), await count("branch_markers"), await count("messages")]).toEqual(before);
    const v = await view(nodeId);
    expect(v.parked).toHaveLength(1);
    expect(v.parked[0].id).toBe(res.body.parked.id);
  });

  it("stores a typed question exactly as typed, and blank input as none", async () => {
    const { nodeId, anchor } = await withReply();
    const a = await call("POST", `/api/nodes/${nodeId}/parked`, { ...anchor, question: "How does this scale?" });
    expect(a.body.parked.question).toBe("How does this scale?");
    const b = await call("POST", `/api/nodes/${nodeId}/parked`, { ...anchor, question: "   " });
    expect(b.body.parked.question).toBeNull();
    const c = await call("POST", `/api/nodes/${nodeId}/parked`, { ...anchor, question: "  keep  spaces " });
    expect(c.body.parked.question).toBe("  keep  spaces ");
    // Newest first (research R10).
    expect((await view(nodeId)).parked.map((p: { id: string }) => p.id)).toEqual([
      c.body.parked.id,
      b.body.parked.id,
      a.body.parked.id,
    ]);
  });

  it("validates the anchor exactly as Branch does", async () => {
    const { nodeId, anchor } = await withReply();
    const bad = await call("POST", `/api/nodes/${nodeId}/parked`, { ...anchor, text: "Something" });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("invalid_selection");
    const other = await root();
    const wrongNode = await call("POST", `/api/nodes/${other}/parked`, anchor);
    expect(wrongNode.status).toBe(422);

    setFakeMode({ mode: "slow", delayMs: 5000 });
    const pending: Msg = (await call("POST", `/api/nodes/${nodeId}/messages`, { content: "more" })).body.aiMessage;
    const notReady = await call("POST", `/api/nodes/${nodeId}/parked`, { ...anchor, messageId: pending.id, start: 0, end: 1, text: "" });
    expect(notReady.status).toBe(409);
    expect(notReady.body.error.code).toBe("message_not_branchable");
    await call("POST", `/api/messages/${pending.id}/stop`, {});
    await drainGenerations();
  });

  it("keeps repeated parks and a direct branch on the same span independent", async () => {
    const { nodeId, anchor } = await withReply();
    await call("POST", `/api/nodes/${nodeId}/parked`, anchor);
    await call("POST", `/api/nodes/${nodeId}/parked`, anchor);
    await call("POST", `/api/nodes/${nodeId}/branches`, anchor);
    const v = await view(nodeId);
    expect(v.parked).toHaveLength(2);
    expect(v.children).toHaveLength(1);
  });

  it("blocks regenerating a reply that has a live parked tangent (research R6)", async () => {
    const { nodeId, ai, anchor } = await withReply();
    expect((await view(nodeId)).canRegenerate).toEqual({ messageId: ai.id });
    const parked = (await call("POST", `/api/nodes/${nodeId}/parked`, anchor)).body.parked;
    expect((await view(nodeId)).canRegenerate).toBeNull();
    const res = await call("POST", `/api/messages/${ai.id}/regenerate`, {});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("has_parked");

    await call("POST", `/api/parked/${parked.id}/discard`);
    expect((await view(nodeId)).canRegenerate).toEqual({ messageId: ai.id });
  });
});

describe("Feature 8 · US2 fire", () => {
  it("with a question: creates the branch, sends the question unchanged and replies", async () => {
    const { nodeId, ai, anchor } = await withReply();
    const parked = (await call("POST", `/api/nodes/${nodeId}/parked`, { ...anchor, question: "How does this scale?" })).body.parked;
    const res = await call("POST", `/api/parked/${parked.id}/fire?wait=1`);
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("sent");
    expect(res.body.node.parentId).toBe(nodeId);
    expect(res.body.marker).toMatchObject({ kind: "selection", messageId: ai.id, start: anchor.start, end: anchor.end });
    expect(res.body.userMessage.content).toBe("How does this scale?");
    expect(res.body.aiMessage.status).toBe("complete");

    const parent = await view(nodeId);
    expect(parent.parked).toHaveLength(0);
    expect(parent.children.map((c: { id: string }) => c.id)).toEqual([res.body.node.id]);
    expect(parent.markers.some((m: { childNodeId: string }) => m.childNodeId === res.body.node.id)).toBe(true);

    const child = await view(res.body.node.id);
    expect(child.messages.map((m: Msg) => m.content)[0]).toBe("How does this scale?");
    // Inherits like a highlight branch: the anchored message is included (FR-013a).
    const inherited = child.inheritedContext.flatMap((e: { messages: Msg[] }) => e.messages.map((m) => m.id));
    expect(inherited).toContain(ai.id);
  });

  it("without a question: creates an empty branch and returns the anchor text as the draft", async () => {
    const { nodeId, anchor } = await withReply();
    const parked = (await call("POST", `/api/nodes/${nodeId}/parked`, anchor)).body.parked;
    const res = await call("POST", `/api/parked/${parked.id}/fire`);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: "preload", draft: "Containers" });
    expect((await view(res.body.node.id)).messages).toHaveLength(0);
  });

  it("fires at most once, even when two requests race", async () => {
    const { nodeId, anchor } = await withReply();
    const parked = (await call("POST", `/api/nodes/${nodeId}/parked`, anchor)).body.parked;
    const [a, b] = await Promise.all([
      call("POST", `/api/parked/${parked.id}/fire`),
      call("POST", `/api/parked/${parked.id}/fire`),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect([a, b].find((r) => r.status === 409)!.body.error.code).toBe("parked_consumed");
    expect((await view(nodeId)).children).toHaveLength(1);
    const again = await call("POST", `/api/parked/${parked.id}/fire`);
    expect(again.status).toBe(409);
  });

  it("still creates the branch and message when the AI service is unreachable", async () => {
    const { nodeId, anchor } = await withReply();
    const parked = (await call("POST", `/api/nodes/${nodeId}/parked`, { ...anchor, question: "Why?" })).body.parked;
    setFakeMode({ mode: "fail" });
    const res = await call("POST", `/api/parked/${parked.id}/fire?wait=1`);
    expect(res.status).toBe(201);
    expect(res.body.userMessage.content).toBe("Why?");
    expect(res.body.aiMessage.status).toBe("failed");
  });

  it("rolls back entirely when the anchor can no longer be branched", async () => {
    const { nodeId, ai, anchor } = await withReply();
    const parked = (await call("POST", `/api/nodes/${nodeId}/parked`, anchor)).body.parked;
    const nodes = await count("nodes");
    await sql`UPDATE messages SET status = 'incomplete' WHERE id = ${ai.id}`.execute(db);
    const res = await call("POST", `/api/parked/${parked.id}/fire`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("message_not_branchable");
    expect(await count("nodes")).toBe(nodes);
    expect((await view(nodeId)).parked).toHaveLength(1);
  });
});

describe("Feature 8 · US3 children", () => {
  it("lists only direct children, newest first", async () => {
    const { nodeId, anchor } = await withReply();
    const a = (await call("POST", `/api/nodes/${nodeId}/branches`, anchor)).body.node.id;
    const b = (await call("POST", `/api/nodes/${nodeId}/branches`, anchor)).body.node.id;
    const aiA: Msg = (await sendAndWait(a, "Deeper")).body.aiMessage;
    const s = aiA.content.indexOf("Containers");
    const grand = (
      await call("POST", `/api/nodes/${a}/branches`, { messageId: aiA.id, start: s, end: s + 10, text: "Containers", prefix: "", suffix: "" })
    ).body.node.id;

    const v = await view(nodeId);
    expect(v.children.map((c: { id: string }) => c.id)).toEqual([b, a]);
    expect(v.children[0].anchorText).toBe("Containers");
    expect(v.children[1].messageCount).toBe(2);
    expect((await view(a)).children.map((c: { id: string }) => c.id)).toEqual([grand]);
  });
});

describe("Feature 8 · US4 edit and discard", () => {
  it("edits, clears and adds a question, and fire follows the current question", async () => {
    const { nodeId, anchor } = await withReply();
    const p = (await call("POST", `/api/nodes/${nodeId}/parked`, { ...anchor, question: "Old" })).body.parked;
    const edited = await call("POST", `/api/parked/${p.id}/question`, { question: "New" });
    expect(edited.status).toBe(200);
    expect(edited.body.parked.question).toBe("New");
    const cleared = await call("POST", `/api/parked/${p.id}/question`, { question: "" });
    expect(cleared.body.parked.question).toBeNull();
    expect((await call("POST", `/api/parked/${p.id}/fire`)).body.kind).toBe("preload");

    const q = (await call("POST", `/api/nodes/${nodeId}/parked`, anchor)).body.parked;
    await call("POST", `/api/parked/${q.id}/question`, { question: "Added" });
    const fired = await call("POST", `/api/parked/${q.id}/fire?wait=1`);
    expect(fired.body.kind).toBe("sent");
    expect(fired.body.userMessage.content).toBe("Added");
  });

  it("writes nothing when the question is unchanged", async () => {
    const { nodeId, anchor } = await withReply();
    const p = (await call("POST", `/api/nodes/${nodeId}/parked`, { ...anchor, question: "Same" })).body.parked;
    await call("POST", `/api/parked/${p.id}/question`, { question: "Same" });
    const events = await db.selectFrom("parked_tangent_events").select("id").where("tangent_id", "=", p.id).execute();
    expect(events).toHaveLength(1);
  });

  it("discards one item only, creates nothing and keeps it on record", async () => {
    const { nodeId, anchor } = await withReply();
    const keep = (await call("POST", `/api/nodes/${nodeId}/parked`, { ...anchor, question: "Keep" })).body.parked;
    const drop = (await call("POST", `/api/nodes/${nodeId}/parked`, anchor)).body.parked;
    const nodes = await count("nodes");
    const res = await call("POST", `/api/parked/${drop.id}/discard`);
    expect(res.status).toBe(200);
    expect(res.body.discarded.id).toBe(drop.id);
    const v = await view(nodeId);
    expect(v.parked).toEqual([keep]);
    expect(await count("nodes")).toBe(nodes);

    for (const path of ["question", "discard", "fire"]) {
      const again = await call("POST", `/api/parked/${drop.id}/${path}`, { question: "x" });
      expect(again.status, path).toBe(409);
      expect(again.body.error.code).toBe("parked_consumed");
    }
    // Recorded, not deleted, and the tables refuse changes (Articles II and VI).
    expect(await db.selectFrom("parked_tangents").select("id").where("id", "=", drop.id).executeTakeFirst()).toBeDefined();
    await expect(sql`UPDATE parked_tangents SET anchor_text = 'x'`.execute(db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM parked_tangent_events`.execute(db)).rejects.toThrow(/append-only/);
  });

  it("returns 404 for an unknown item", async () => {
    const res = await call("POST", `/api/parked/00000000-0000-4000-8000-000000000000/discard`);
    expect(res.status).toBe(404);
  });
});
