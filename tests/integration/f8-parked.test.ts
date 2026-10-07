import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { setFakeMode } from "@/server/ai/fake";
import { db } from "@/server/db/client";
import { call, newProject, startTree } from "./helpers";

// Feature 8 parked tangents, re-targeted to v2 elements (Feature 10, FR-021, T055).

/** A tree with one complete answer, and a valid span on "Containers" in it. */
async function withAnswer() {
  const projectId = await newProject();
  const t = await startTree(projectId, "Tell me about Pods");
  const start = t.answer.text.indexOf("Containers");
  const span = { start, end: start + 10, text: "Containers" };
  return { ...t, projectId, span };
}

const countNodes = async () => (await sql<{ n: number }>`SELECT count(*)::int AS n FROM nodes`.execute(db)).rows[0].n;
const panel = async (id: string) => (await call("GET", `/api/nodes/${id}/panel`)).body;

describe("Feature 8 (v2) · park", () => {
  it("parks on an answer span without creating or changing any element", async () => {
    const { answer, span } = await withAnswer();
    const before = await db.selectFrom("nodes").selectAll().orderBy("id").execute();
    const res = await call("POST", `/api/nodes/${answer.id}/parked`, span);
    expect(res.status).toBe(201);
    expect(res.body.parked).toMatchObject({ nodeId: answer.id, question: null, anchor: { ...span, suffix: " are mentioned here.**" } });
    expect(await db.selectFrom("nodes").selectAll().orderBy("id").execute()).toEqual(before);
    expect((await panel(answer.id)).parked).toEqual([res.body.parked]);
  });

  it("parks on a question edge's own words", async () => {
    const { edge } = await withAnswer();
    const start = edge.text.indexOf("Pods");
    const res = await call("POST", `/api/nodes/${edge.id}/parked`, { start, end: start + 4, text: "Pods" });
    expect(res.status).toBe(201);
    expect(res.body.parked.nodeId).toBe(edge.id);
  });

  it("stores a typed question exactly as typed, and blank input as none", async () => {
    const { answer, span } = await withAnswer();
    const typed = await call("POST", `/api/nodes/${answer.id}/parked`, { ...span, question: "  Why *these*?  " });
    expect(typed.body.parked.question).toBe("  Why *these*?  ");
    const blank = await call("POST", `/api/nodes/${answer.id}/parked`, { ...span, question: "   " });
    expect(blank.body.parked.question).toBeNull();
  });

  it("validates the span exactly as Branch does", async () => {
    const { answer, span } = await withAnswer();
    expect((await call("POST", `/api/nodes/${answer.id}/parked`, { ...span, text: "Nope" })).status).toBe(422);
    expect((await call("POST", `/api/nodes/${answer.id}/parked`, { start: 0, end: 999, text: "x" })).status).toBe(422);
    const run = await call("POST", `/api/nodes/${answer.id}/functions/analogy/run`);
    const out = run.body.output;
    const res = await call("POST", `/api/nodes/${out.id}/parked`, { start: 0, end: 4, text: out.text.slice(0, 4) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("not_branchable");
  });
});

describe("Feature 8 (v2) · fire", () => {
  it("with a question: creates a sent parked edge, replies, and records the edge", async () => {
    const { answer, span } = await withAnswer();
    const parked = (await call("POST", `/api/nodes/${answer.id}/parked`, { ...span, question: "Why these?" })).body.parked;
    const res = await call("POST", `/api/parked/${parked.id}/fire?wait=1`);
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("sent");
    expect(res.body.edge).toMatchObject({ parentId: answer.id, origin: "parked", text: "Why these?", anchor: { text: "Containers" } });
    expect(res.body.answer).toMatchObject({ parentId: res.body.edge.id, status: "complete" });
    const fired = await db.selectFrom("parked_tangent_events").selectAll().where("kind", "=", "fired").executeTakeFirstOrThrow();
    expect(fired.edge_id).toBe(res.body.edge.id);
    expect((await panel(answer.id)).parked).toEqual([]);
  });

  it("without a question: an unsent edge, and the anchor text as the draft", async () => {
    const { answer, span } = await withAnswer();
    const parked = (await call("POST", `/api/nodes/${answer.id}/parked`, span)).body.parked;
    const res = await call("POST", `/api/parked/${parked.id}/fire`);
    expect(res.body).toMatchObject({ kind: "preload", draft: "Containers", edge: { text: null, state: "unsent", origin: "parked" } });
  });

  it("fires at most once, even when two requests race", async () => {
    const { answer, span } = await withAnswer();
    const parked = (await call("POST", `/api/nodes/${answer.id}/parked`, span)).body.parked;
    const [a, b] = await Promise.all([call("POST", `/api/parked/${parked.id}/fire`), call("POST", `/api/parked/${parked.id}/fire`)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect([a, b].find((r) => r.status === 409)!.body.error.code).toBe("parked_consumed");
    expect((await panel(answer.id)).children).toHaveLength(1);
    expect((await call("POST", `/api/parked/${parked.id}/fire`)).status).toBe(409);
  });

  it("still creates the edge when the AI service is unreachable", async () => {
    const { answer, span } = await withAnswer();
    const parked = (await call("POST", `/api/nodes/${answer.id}/parked`, { ...span, question: "Why?" })).body.parked;
    setFakeMode({ mode: "fail" });
    const res = await call("POST", `/api/parked/${parked.id}/fire?wait=1`);
    expect(res.status).toBe(201);
    expect(res.body.edge.text).toBe("Why?");
    expect(res.body.answer.status).toBe("failed");
  });
});

describe("Feature 8 (v2) · edit and discard", () => {
  it("edits, clears and adds a question, and fire follows the current question", async () => {
    const { answer, span } = await withAnswer();
    const p = (await call("POST", `/api/nodes/${answer.id}/parked`, { ...span, question: "Old" })).body.parked;
    const edited = await call("PUT", `/api/parked/${p.id}/question`, { question: "New" });
    expect(edited.status).toBe(200);
    expect(edited.body.parked.question).toBe("New");
    const cleared = await call("PUT", `/api/parked/${p.id}/question`, { question: "" });
    expect(cleared.body.parked.question).toBeNull();
    expect((await call("POST", `/api/parked/${p.id}/fire`)).body.kind).toBe("preload");

    const q = (await call("POST", `/api/nodes/${answer.id}/parked`, span)).body.parked;
    await call("PUT", `/api/parked/${q.id}/question`, { question: "Added" });
    const fired = await call("POST", `/api/parked/${q.id}/fire?wait=1`);
    expect(fired.body.kind).toBe("sent");
    expect(fired.body.edge.text).toBe("Added");
  });

  it("writes nothing when the question is unchanged", async () => {
    const { answer, span } = await withAnswer();
    const p = (await call("POST", `/api/nodes/${answer.id}/parked`, { ...span, question: "Same" })).body.parked;
    await call("PUT", `/api/parked/${p.id}/question`, { question: "Same" });
    const events = await db.selectFrom("parked_tangent_events").select("id").where("tangent_id", "=", p.id).execute();
    expect(events).toHaveLength(1);
  });

  it("discards one item only, creates nothing and keeps it on record", async () => {
    const { answer, span } = await withAnswer();
    const keep = (await call("POST", `/api/nodes/${answer.id}/parked`, { ...span, question: "Keep" })).body.parked;
    const drop = (await call("POST", `/api/nodes/${answer.id}/parked`, span)).body.parked;
    const nodes = await countNodes();
    const res = await call("POST", `/api/parked/${drop.id}/discard`);
    expect(res.status).toBe(200);
    expect(res.body.parked.id).toBe(drop.id);
    expect((await panel(answer.id)).parked).toEqual([keep]);
    expect(await countNodes()).toBe(nodes);

    for (const [method, path] of [["PUT", "question"], ["POST", "discard"], ["POST", "fire"]]) {
      const again = await call(method, `/api/parked/${drop.id}/${path}`, { question: "x" });
      expect(again.status, path).toBe(409);
      expect(again.body.error.code).toBe("parked_consumed");
    }
    expect(await db.selectFrom("parked_tangents").select("id").where("id", "=", drop.id).executeTakeFirst()).toBeDefined();
    await expect(sql`UPDATE parked_tangents SET anchor_text = 'x'`.execute(db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM parked_tangent_events`.execute(db)).rejects.toThrow(/append-only/);
  });

  it("returns 404 for an unknown item", async () => {
    const res = await call("POST", `/api/parked/00000000-0000-4000-8000-000000000000/discard`);
    expect(res.status).toBe(404);
  });
});
