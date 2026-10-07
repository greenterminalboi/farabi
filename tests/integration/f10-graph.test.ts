import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { getFakeCalls, setFakeMode } from "@/server/ai/fake";
import { drainGenerations } from "@/server/answers/generation";
import { db } from "@/server/db/client";
import { askAndWait, call, newProject, readStream, startTree } from "./helpers";

// Feature 10: the message graph through its HTTP routes (contracts/http-api.md).

const echo = (q: string) => `Echo: ${q}. **Containers are mentioned here.**`;

function spanOf(text: string, phrase: string) {
  const start = text.indexOf(phrase);
  if (start < 0) throw new Error(`no "${phrase}" in ${text}`);
  return { start, end: start + phrase.length, text: phrase };
}

const canvas = async (projectId: string) => (await call("GET", `/api/canvas?projectId=${projectId}`)).body;
const allReplyText = () =>
  getFakeCalls()
    .replyInputs.flatMap((i) => i.messages.map((m) => m.content))
    .join("\n");

describe("Feature 10 · asking (story 1)", () => {
  it("starts a tree with an origin edge and a pending answer, then streams it", async () => {
    const projectId = await newProject();
    const res = await call("POST", "/api/trees", { projectId, content: "Explain Pods" });
    expect(res.status).toBe(201);
    const { tree, edge, answer } = res.body;
    expect(edge).toMatchObject({
      kind: "question",
      shape: "edge",
      origin: "origin",
      parentId: null,
      provenance: "user_authored",
      text: "Explain Pods",
      treeId: tree.id,
    });
    expect(answer).toMatchObject({
      kind: "answer",
      shape: "node",
      origin: "reply",
      parentId: edge.id,
      provenance: "ai_suggested",
      status: "pending",
    });
    expect(tree.rootAnswerId).toBe(answer.id);

    const events = await readStream(answer.id);
    expect(events[0].event).toBe("snapshot");
    const end = events.at(-1)!;
    expect(end.event).toBe("end");
    expect(end.data.answer.status).toBe("complete");
    const streamed = events[0].data.text + events.filter((e) => e.event === "delta").map((e) => e.data.text).join("");
    expect(streamed).toBe(end.data.answer.text);
    expect(events.filter((e) => e.event === "delta").length).toBeGreaterThan(1);
  });

  it("?wait=1 returns the answered tree, and the canvas shows it", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "hello");
    expect(t.answer).toMatchObject({ status: "complete", text: echo("hello") });
    const c = await canvas(projectId);
    expect(c.trees).toHaveLength(1);
    expect(c.trees[0].rootAnswerId).toBe(t.answer.id);
    const edge = c.elements.find((e: { id: string }) => e.id === t.edge.id);
    expect(edge.state).toBe("answered");
    expect(c.camera).toBeNull();
  });

  it("asks from an answer, and asking again adds a sibling without changing the first (FR-013)", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    const first = await askAndWait(t.answer.id, "Services");
    expect(first.status).toBe(201);
    expect(first.body.kind).toBe("message");
    expect(first.body.edge).toMatchObject({ parentId: t.answer.id, origin: "ask", state: "replying" });
    expect(first.body.answer).toMatchObject({ parentId: first.body.edge.id, status: "complete" });

    const before = await db.selectFrom("nodes").selectAll().where("id", "=", first.body.edge.id).executeTakeFirstOrThrow();
    const second = await askAndWait(t.answer.id, "Volumes");
    expect(second.body.edge.parentId).toBe(t.answer.id);
    const after = await db.selectFrom("nodes").selectAll().where("id", "=", first.body.edge.id).executeTakeFirstOrThrow();
    expect(after).toEqual(before);
  });

  it("refuses to ask while the reply is still arriving", async () => {
    const projectId = await newProject();
    setFakeMode({ mode: "slow", delayMs: 400 });
    const res = await call("POST", "/api/trees", { projectId, content: "slow one" });
    const fromAnswer = await call("POST", `/api/nodes/${res.body.answer.id}/ask`, { content: "too soon" });
    expect(fromAnswer.status).toBe(409);
    expect(fromAnswer.body.error.code).toBe("reply_in_progress");
    const fromEdge = await call("POST", `/api/nodes/${res.body.edge.id}/ask`, { content: "too soon" });
    expect(fromEdge.status).toBe(409);
    expect(fromEdge.body.error.code).toBe("reply_in_progress");
    await drainGenerations();
  });

  it("accepts any text for an origin edge but not an empty one (FR-014)", async () => {
    const projectId = await newProject();
    for (const text of ["not a question at all", "????", "# heading\n\n- a list"]) {
      const res = await call("POST", "/api/trees", { projectId, content: text });
      expect(res.status).toBe(201);
      expect(res.body.edge.text).toBe(text);
    }
    expect((await call("POST", "/api/trees", { projectId, content: "  " })).status).toBe(422);
    await drainGenerations();
  });

  it("stores the question when the AI is unreachable; the answer fails and the edge says so", async () => {
    const projectId = await newProject();
    setFakeMode({ mode: "fail" });
    const t = await startTree(projectId, "offline");
    expect(t.edge.text).toBe("offline");
    expect(t.answer.status).toBe("failed");
    const c = await canvas(projectId);
    expect(c.elements.find((e: { id: string }) => e.id === t.edge.id).state).toBe("failed");
    expect((await call("POST", `/api/nodes/${t.answer.id}/ask`, { content: "x" })).body.error.code).toBe("not_askable");
  });

  it("Stop keeps the text so far, marked stopped", async () => {
    const projectId = await newProject();
    const res = await call("POST", "/api/trees", { projectId, content: "a long answer please" });
    await new Promise((r) => setTimeout(r, 100)); // let a couple of chunks arrive
    const stop = await call("POST", `/api/answers/${res.body.answer.id}/stop`, {});
    expect(stop.status).toBe(200);
    expect(stop.body.answer.status).toBe("stopped");
    expect(stop.body.answer.text.length).toBeGreaterThan(0);
    expect(echo("a long answer please")).toContain(stop.body.answer.text);
    expect((await call("POST", `/api/answers/${res.body.answer.id}/stop`, {})).status).toBe(409);
    const c = await canvas(projectId);
    expect(c.elements.find((e: { id: string }) => e.id === res.body.edge.id).state).toBe("stopped");
  });

  it("finalizes an orphaned pending answer from its checkpoint", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    // A pending answer whose generator is gone (a restart): written directly.
    const orphan = await db
      .insertInto("nodes")
      .values({
        project_id: projectId,
        tree_id: t.tree.id,
        parent_id: t.edge.id,
        kind: "answer",
        shape: "node",
        origin: "retry",
        provenance: "ai_suggested",
        text: "",
        status: "pending",
        properties: "{}",
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await db.updateTable("nodes").set({ partial_text: "half a th" }).where("id", "=", orphan.id).execute();
    const c = await canvas(projectId);
    expect(c.elements.find((e: { id: string }) => e.id === orphan.id)).toMatchObject({
      status: "incomplete",
      text: "half a th",
      partialText: null,
    });
  });

  it("refuses to ask from an unsent edge, a function edge or an output", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    const branch = await call("POST", `/api/nodes/${t.answer.id}/branches`, spanOf(t.answer.text, "Containers"));
    const res = await call("POST", `/api/nodes/${branch.body.edge.id}/ask`, { content: "x" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("not_askable");
    const run = await call("POST", `/api/nodes/${t.answer.id}/functions/analogy/run`);
    for (const id of [run.body.edge.id, run.body.output.id]) {
      expect((await call("POST", `/api/nodes/${id}/ask`, { content: "x" })).body.error.code).toBe("not_askable");
    }
  });
});

describe("Feature 10 · branching (story 3)", () => {
  it("branches from an answer span: an unsent edge with the anchor, and no AI call", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    const calls = getFakeCalls().replyInputs.length;
    const span = spanOf(t.answer.text, "Containers");
    const res = await call("POST", `/api/nodes/${t.answer.id}/branches`, span);
    expect(res.status).toBe(201);
    expect(res.body.edge).toMatchObject({
      parentId: t.answer.id,
      origin: "branch",
      text: null,
      state: "unsent",
      provenance: "user_authored",
      anchor: {
        ...span,
        prefix: t.answer.text.slice(Math.max(0, span.start - 32), span.start),
        suffix: t.answer.text.slice(span.end, span.end + 32),
      },
    });
    await drainGenerations();
    expect(getFakeCalls().replyInputs.length).toBe(calls);
  });

  it("branches from a question edge's own words", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Tell me about Pods");
    const res = await call("POST", `/api/nodes/${t.edge.id}/branches`, spanOf(t.edge.text, "Pods"));
    expect(res.status).toBe(201);
    expect(res.body.edge.parentId).toBe(t.edge.id);
  });

  it("rejects invalid spans and unfinished text", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    const len = t.answer.text.length;
    const bad = [
      { start: 5, end: 5, text: "" },
      { start: 0, end: len + 1, text: t.answer.text + "x" },
      { start: 0, end: 4, text: "Nope" },
      { start: 5, end: 6, text: " " },
    ];
    for (const span of bad) {
      const res = await call("POST", `/api/nodes/${t.answer.id}/branches`, span);
      expect([422, 400]).toContain(res.status);
    }
    setFakeMode({ mode: "slow", delayMs: 400 });
    const pending = await call("POST", `/api/nodes/${t.answer.id}/ask`, { content: "slow" });
    const res = await call("POST", `/api/nodes/${pending.body.answer.id}/branches`, { start: 0, end: 1, text: "E" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("not_branchable");
    await drainGenerations();
  });

  it("sends an unsent edge once (FR-017)", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    const branch = await call("POST", `/api/nodes/${t.answer.id}/branches`, spanOf(t.answer.text, "Containers"));
    const sent = await call("POST", `/api/edges/${branch.body.edge.id}/send?wait=1`, { content: "Why containers?" });
    expect(sent.status).toBe(201);
    expect(sent.body.edge).toMatchObject({ text: "Why containers?", origin: "branch" });
    expect(sent.body.edge.sentAt).not.toBeNull();
    expect(sent.body.answer).toMatchObject({ status: "complete", parentId: branch.body.edge.id });
    const again = await call("POST", `/api/edges/${branch.body.edge.id}/send`, { content: "again" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("already_sent");
  });

  it("supports any number of overlapping markers on one element (FR-019)", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    const spans = [spanOf(t.answer.text, "Containers"), spanOf(t.answer.text, "Containers are"), spanOf(t.answer.text, "Containers")];
    for (const span of spans) expect((await call("POST", `/api/nodes/${t.answer.id}/branches`, span)).status).toBe(201);
    const panel = await call("GET", `/api/nodes/${t.answer.id}/panel`);
    expect(panel.body.children).toHaveLength(3);
  });

  it("re-asks with ???? as a sibling edge from the source, never sending ???? (FR-020)", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    const q = (await askAndWait(t.answer.id, "What is a sidecar?")).body;
    const res = await call("POST", `/api/nodes/${q.answer.id}/ask?wait=1`, { content: "????" });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("quick_branch");
    expect(res.body.edge).toMatchObject({
      parentId: t.answer.id,
      origin: "quick_branch",
      requeryOf: q.edge.id,
      text: "What is a sidecar?",
    });
    expect(res.body.answer.status).toBe("complete");
    // The context excludes the re-asked edge: it is a sibling, never an ancestor.
    const last = getFakeCalls().lastReply!;
    expect(last.messages.map((m) => m.content)).toEqual(["Pods", echo("Pods"), "What is a sidecar?"]);
    expect(allReplyText()).not.toContain("????");

    // A second ???? for the same edge is an ordinary message.
    const second = await call("POST", `/api/nodes/${q.answer.id}/ask?wait=1`, { content: "????" });
    expect(second.body.kind).toBe("message");
    expect(second.body.edge).toMatchObject({ text: "????", parentId: q.answer.id });
  });

  it("treats ???? on the origin edge's answer as an ordinary message", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    const res = await call("POST", `/api/nodes/${t.answer.id}/ask?wait=1`, { content: "????" });
    expect(res.body.kind).toBe("message");
    expect(res.body.edge.text).toBe("????");
  });

  it("lists direct child edges newest first in the side panel (FR-022)", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    const a = (await askAndWait(t.answer.id, "First")).body;
    const b = await call("POST", `/api/nodes/${t.answer.id}/branches`, spanOf(t.answer.text, "Containers"));
    await askAndWait(a.answer.id, "Grandchild");
    const panel = await call("GET", `/api/nodes/${t.answer.id}/panel`);
    expect(panel.body.children.map((e: { id: string }) => e.id)).toEqual([b.body.edge.id, a.edge.id]);
    expect(panel.body.children.map((e: { state: string }) => e.state)).toEqual(["unsent", "answered"]);
    expect(panel.body.parked).toEqual([]);
  });
});

describe("Feature 10 · attempts (story 7)", () => {
  it("retries an unfinished reply as a sibling, keeping the first", async () => {
    const projectId = await newProject();
    setFakeMode({ mode: "stall" });
    const t = await startTree(projectId, "try again");
    expect(t.answer.status).toBe("incomplete");
    setFakeMode({ mode: "ok" });
    const res = await call("POST", `/api/edges/${t.edge.id}/attempts?wait=1`, { mode: "retry" });
    expect(res.status).toBe(201);
    expect(res.body.answer).toMatchObject({ parentId: t.edge.id, origin: "retry", status: "complete" });
    const first = await db.selectFrom("nodes").selectAll().where("id", "=", t.answer.id).executeTakeFirstOrThrow();
    expect(first.status).toBe("incomplete");
    const again = await call("POST", `/api/edges/${t.edge.id}/attempts`, { mode: "retry" });
    expect(again.body.error.code).toBe("not_retryable");
  });

  it("regenerates a complete reply even after a branch exists on it (FR-041, FR-042)", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    const branch = await call("POST", `/api/nodes/${t.answer.id}/branches`, spanOf(t.answer.text, "Containers"));
    const res = await call("POST", `/api/edges/${t.edge.id}/attempts?wait=1`, { mode: "regenerate" });
    expect(res.status).toBe(201);
    expect(res.body.answer).toMatchObject({ parentId: t.edge.id, origin: "regenerate", status: "complete" });
    const kept = await db.selectFrom("nodes").select("parent_id").where("id", "=", branch.body.edge.id).executeTakeFirstOrThrow();
    expect(kept.parent_id).toBe(t.answer.id);
  });

  it("refuses to regenerate without a complete attempt, and either while one is pending", async () => {
    const projectId = await newProject();
    setFakeMode({ mode: "fail" });
    const t = await startTree(projectId, "nope");
    const res = await call("POST", `/api/edges/${t.edge.id}/attempts`, { mode: "regenerate" });
    expect(res.body.error.code).toBe("not_regenerable");
    setFakeMode({ mode: "slow", delayMs: 300 });
    await call("POST", `/api/edges/${t.edge.id}/attempts`, { mode: "retry" });
    const busy = await call("POST", `/api/edges/${t.edge.id}/attempts`, { mode: "retry" });
    expect(busy.body.error.code).toBe("reply_in_progress");
    await drainGenerations();
    const notEdge = await call("POST", `/api/edges/${t.answer.id}/attempts`, { mode: "retry" });
    expect(notEdge.body.error.code).toBe("not_an_edge");
  });

  it("derives the edge state from the newest attempt", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    setFakeMode({ mode: "stall" });
    await call("POST", `/api/edges/${t.edge.id}/attempts?wait=1`, { mode: "regenerate" });
    const c = await canvas(projectId);
    expect(c.elements.find((e: { id: string }) => e.id === t.edge.id).state).toBe("incomplete");
    // The tree's root stays the earliest answer (FR-005).
    expect(c.trees[0].rootAnswerId).toBe(t.answer.id);
  });
});

describe("Feature 10 · arranging (story 6)", () => {
  it("places an element relative to its tree without touching structure, and refuses the origin", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    const res = await call("PUT", `/api/nodes/${t.answer.id}/position`, { x: 12.5, y: -40 });
    expect(res.status).toBe(200);
    expect(res.body.element.manual).toEqual({ x: 12.5, y: -40 });
    expect(res.body.element.parentId).toBe(t.edge.id);
    const origin = await call("PUT", `/api/nodes/${t.edge.id}/position`, { x: 1, y: 1 });
    expect(origin.status).toBe(409);
    expect(origin.body.error.code).toBe("origin_edge");
    expect((await call("PUT", `/api/nodes/${t.answer.id}/position`, { x: "a", y: 1 })).status).toBe(422);
  });

  it("moves a tree and marks it placed by the user", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    const res = await call("PUT", `/api/trees/${t.tree.id}/origin`, { x: 300, y: 200 });
    expect(res.body.tree).toEqual({ id: t.tree.id, origin: { x: 300, y: 200 }, userPlaced: true, rootAnswerId: t.answer.id });
  });

  it("notes an edge, keeping every version; clears it; refuses nodes and long notes (FR-040)", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    expect((await call("PUT", `/api/edges/${t.edge.id}/note`, { text: "  builds   on " })).body.edge.note).toBe("builds on");
    expect((await call("PUT", `/api/edges/${t.edge.id}/note`, { text: "contrasts" })).body.edge.note).toBe("contrasts");
    expect((await call("PUT", `/api/edges/${t.edge.id}/note`, { text: " " })).body.edge.note).toBeNull();
    const rows = await db.selectFrom("edge_notes").select(["text", "provenance"]).orderBy("created_at").execute();
    expect(rows).toEqual([
      { text: "builds on", provenance: "user_authored" },
      { text: "contrasts", provenance: "user_authored" },
      { text: null, provenance: "user_authored" },
    ]);
    await call("PUT", `/api/edges/${t.edge.id}/note`, { text: "current" });
    const c = await canvas(projectId);
    expect(c.elements.find((e: { id: string }) => e.id === t.edge.id).note).toBe("current");
    expect((await call("PUT", `/api/edges/${t.answer.id}/note`, { text: "x" })).body.error.code).toBe("not_an_edge");
    expect((await call("PUT", `/api/edges/${t.edge.id}/note`, { text: "x".repeat(201) })).status).toBe(422);
  });

  it("saves the camera per project and returns it with the canvas (FR-028)", async () => {
    const projectId = await newProject();
    const res = await call("PUT", `/api/projects/${projectId}/camera`, { x: 10, y: -20, scale: 0.5 });
    expect(res.body.camera).toEqual({ x: 10, y: -20, scale: 0.5 });
    await call("PUT", `/api/projects/${projectId}/camera`, { x: 1, y: 2, scale: 2 });
    expect((await canvas(projectId)).camera).toEqual({ x: 1, y: 2, scale: 2 });
    expect((await call("PUT", `/api/projects/${projectId}/camera`, { x: 0, y: 0, scale: 9 })).status).toBe(422);
  });
});

describe("Feature 10 · the canvas", () => {
  it("returns every element of the project and nothing of another project or the trash", async () => {
    const a = await newProject("A");
    const b = await newProject("B");
    const ta = await startTree(a, "In A");
    await startTree(b, "In B");
    const c = await canvas(a);
    expect(c.elements.map((e: { id: string }) => e.id).sort()).toEqual([ta.edge.id, ta.answer.id].sort());
    await call("POST", `/api/projects/${a}/trash`);
    expect((await call("GET", `/api/canvas?projectId=${a}`)).status).toBe(404);
  });

  it("keeps rejected outputs in the payload with their review (FR-050)", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    const run = await call("POST", `/api/nodes/${t.answer.id}/functions/analogy/run`);
    await call("POST", `/api/nodes/${run.body.output.id}/reject`);
    const c = await canvas(projectId);
    expect(c.elements.find((e: { id: string }) => e.id === run.body.output.id).review).toBe("rejected");
    expect(c.elements.find((e: { id: string }) => e.id === run.body.edge.id)).toMatchObject({
      review: "rejected",
      functionName: "Analogy",
    });
  });

  it("serves 404 for unknown and malformed ids", async () => {
    expect((await call("POST", `/api/nodes/not-a-uuid/ask`, { content: "x" })).status).toBe(404);
    expect((await call("GET", `/api/nodes/${crypto.randomUUID()}/panel`)).status).toBe(404);
    expect((await call("POST", "/api/trees", { projectId: crypto.randomUUID(), content: "x" })).status).toBe(404);
  });

  it("serializes nothing outside the graph's rules: the database refuses re-parenting", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    await expect(sql`UPDATE nodes SET parent_id = NULL WHERE id = ${t.answer.id}`.execute(db)).rejects.toThrow();
  });
});
