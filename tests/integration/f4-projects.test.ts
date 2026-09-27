import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { call, createFeedback, sendAndWait } from "./helpers";

const as = (projectId: string) => ({ cookie: `farabi_project=${projectId}` });
const cookieOf = (res: Response) => /farabi_project=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];

async function create(name: string) {
  const { callRaw } = await import("./helpers");
  const res = await callRaw("POST", "/api/projects", { name });
  const body = await res.json();
  return { status: res.status, project: body.project, cookie: cookieOf(res), body };
}

async function capture(projectId: string, nodeId: string, word: string) {
  const ai = (await sendAndWait(nodeId, "Pods")).body.aiMessage;
  const start = ai.content.indexOf(word);
  return call("POST", "/api/definitions", { nodeId, messageId: ai.id, start, end: start + word.length, text: word }, as(projectId));
}

describe("Feature 4: projects", () => {
  it("creates a default project on first use", async () => {
    const res = await call("GET", "/api/projects");
    expect(res.body.projects).toHaveLength(1);
    expect(res.body.projects[0].name).toBe("My first project");
    expect(res.body.currentId).toBe(res.body.projects[0].id);
    expect((await call("GET", "/api/projects")).body.projects).toHaveLength(1); // not created twice
  });

  it("creates a named project, opens it with a cookie, and refuses blank names", async () => {
    const b = await create("  Physics   notes ");
    expect(b.status).toBe(201);
    expect(b.project.name).toBe("Physics notes");
    expect(b.cookie).toBe(b.project.id);
    expect((await create("   ")).status).toBe(422);
    expect((await create("x".repeat(81))).status).toBe(422);
  });

  it("scopes the map and new trees to the open project", async () => {
    const a = (await call("GET", "/api/projects")).body.currentId;
    const b = (await create("B")).project.id;
    const inA = await call("POST", "/api/trees", {}, as(a));
    const inB = await call("POST", "/api/trees", {}, as(b));
    expect(inB.body.tree.origin.x).toBe(0); // each project's map starts at the origin
    const forestA = (await call("GET", "/api/forest", undefined, as(a))).body;
    const forestB = (await call("GET", "/api/forest", undefined, as(b))).body;
    expect(forestA.trees.map((t: { id: string }) => t.id)).toEqual([inA.body.tree.id]);
    expect(forestB.trees.map((t: { id: string }) => t.id)).toEqual([inB.body.tree.id]);
    expect(forestB.nodes.map((n: { id: string }) => n.id)).toEqual([inB.body.node.id]);
  });

  it("keeps definitions per project", async () => {
    const a = (await call("GET", "/api/projects")).body.currentId;
    const b = (await create("B")).project.id;
    const nodeA = (await call("POST", "/api/trees", {}, as(a))).body.node.id;
    const nodeB = (await call("POST", "/api/trees", {}, as(b))).body.node.id;
    expect((await capture(a, nodeA, "Containers")).body.created).toBe(true);
    expect((await capture(b, nodeB, "Containers")).body.created).toBe(true); // same term, other project
    expect((await capture(a, nodeA, "Containers")).body.created).toBe(false);
    const listA = (await call("GET", "/api/definitions", undefined, as(a))).body.definitions;
    const indexB = (await call("GET", "/api/definitions?index=1", undefined, as(b))).body.terms;
    expect(listA).toHaveLength(1);
    expect(listA[0].source.nodeId).toBe(nodeA);
    expect(indexB).toHaveLength(1);
  });

  it("falls back from an unknown or trashed cookie to the oldest active project", async () => {
    const a = (await call("GET", "/api/projects")).body.currentId;
    const b = (await create("B")).project.id;
    expect((await call("GET", "/api/projects", undefined, as(crypto.randomUUID()))).body.currentId).toBe(a);
    expect((await call("GET", "/api/projects", undefined, { cookie: "farabi_project=junk" })).body.currentId).toBe(a);
    await call("POST", `/api/projects/${b}/trash`, {}, as(a));
    expect((await call("GET", "/api/projects", undefined, as(b))).body.currentId).toBe(a);
    expect((await call("POST", `/api/projects/${b}/open`, {}, as(a))).status).toBe(409);
    expect((await call("POST", `/api/projects/${crypto.randomUUID()}/open`, {})).status).toBe(404);
  });

  it("trash hides a project and keeps all its data; restore brings it back", async () => {
    const a = (await call("GET", "/api/projects")).body.currentId;
    const b = (await create("B")).project.id;
    const node = (await call("POST", "/api/trees", {}, as(b))).body.node.id;
    await sendAndWait(node, "hello");
    const fb = (await createFeedback({ text: "about B", view: "chat", nodeId: node })).body.item;
    const before = (await call("GET", "/api/forest", undefined, as(b))).body;

    // Trashing the open project moves the cookie to another one.
    const { callRaw } = await import("./helpers");
    const trashed = await callRaw("POST", `/api/projects/${b}/trash`, {}, as(b));
    const trashBody = await trashed.json();
    expect(trashBody.currentId).toBe(a);
    expect(cookieOf(trashed)).toBe(a);
    const list = (await call("GET", "/api/projects", undefined, as(a))).body;
    expect(list.projects.map((p: { id: string }) => p.id)).toEqual([a]);
    expect(list.trashed.map((p: { id: string }) => p.id)).toEqual([b]);

    // Nothing was removed: the conversation and the feedback link still work.
    expect((await call("GET", `/api/nodes/${node}`)).status).toBe(200);
    expect((await call("GET", "/api/feedback")).body.items[0].context.nodeId).toBe(fb.context.nodeId);

    expect((await call("POST", `/api/projects/${b}/restore`, {})).body.project.trashedAt).toBeNull();
    expect((await call("GET", "/api/forest", undefined, as(b))).body).toEqual(before);
  });

  it("trashing the last project creates an empty Untitled project", async () => {
    const a = (await call("GET", "/api/projects")).body.currentId;
    const res = await call("POST", `/api/projects/${a}/trash`, {}, as(a));
    const list = (await call("GET", "/api/projects", undefined, as(res.body.currentId))).body;
    expect(list.projects).toHaveLength(1);
    expect(list.projects[0].name).toBe("Untitled project");
    expect(list.currentId).toBe(res.body.currentId);
    expect(await db.selectFrom("projects").select("id").execute()).toHaveLength(2);
  });
});
