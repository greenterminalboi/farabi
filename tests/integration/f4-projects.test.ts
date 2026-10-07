import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { call, createFeedback, startTree } from "./helpers";

const as = (projectId: string) => ({ cookie: `farabi_project=${projectId}` });
const cookieOf = (res: Response) => /farabi_project=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];

async function create(name: string) {
  const { callRaw } = await import("./helpers");
  const res = await callRaw("POST", "/api/projects", { name });
  const body = await res.json();
  return { status: res.status, project: body.project, cookie: cookieOf(res), body };
}

async function capture(projectId: string, answer: { id: string; text: string }, word: string) {
  const start = answer.text.indexOf(word);
  return call("POST", "/api/definitions", { nodeId: answer.id, start, end: start + word.length, text: word }, as(projectId));
}

const canvasOf = async (projectId: string) => (await call("GET", `/api/canvas?projectId=${projectId}`)).body;

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

  it("scopes the canvas and new trees to their project (FR-023)", async () => {
    const a = (await call("GET", "/api/projects")).body.currentId;
    const b = (await create("B")).project.id;
    const inA = await startTree(a, "in A");
    const inB = await startTree(b, "in B");
    expect(inB.tree.origin.x).toBe(0); // each project's canvas starts at the origin
    expect((await startTree(b, "again")).tree.origin.x).toBeGreaterThan(0);
    const canvasA = await canvasOf(a);
    expect(canvasA.trees.map((t: { id: string }) => t.id)).toEqual([inA.tree.id]);
    expect(canvasA.elements.map((n: { id: string }) => n.id).sort()).toEqual([inA.edge.id, inA.answer.id].sort());
    // The cookie picks the canvas when no project is named.
    expect((await call("GET", "/api/canvas", undefined, as(b))).body.trees).toHaveLength(2);
    expect((await canvasOf(b)).elements.map((n: { id: string }) => n.id)).toContain(inB.edge.id);
  });

  it("keeps definitions per project", async () => {
    const a = (await call("GET", "/api/projects")).body.currentId;
    const b = (await create("B")).project.id;
    const nodeA = (await startTree(a, "Pods")).answer;
    const nodeB = (await startTree(b, "Pods")).answer;
    expect((await capture(a, nodeA, "Containers")).body.created).toBe(true);
    expect((await capture(b, nodeB, "Containers")).body.created).toBe(true); // same term, other project
    expect((await capture(a, nodeA, "Containers")).body.created).toBe(false);
    const listA = (await call("GET", "/api/definitions", undefined, as(a))).body.definitions;
    const indexB = (await call("GET", "/api/definitions?index=1", undefined, as(b))).body.terms;
    expect(listA).toHaveLength(1);
    expect(listA[0].source).toMatchObject({ elementId: nodeA.id, projectId: a });
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
    const node = (await startTree(b, "hello")).answer.id;
    const fb = (await createFeedback({ text: "about B", view: "canvas", projectId: b, elementId: node })).body.item;
    const before = await canvasOf(b);

    // Trashing the open project moves the cookie to another one.
    const { callRaw } = await import("./helpers");
    const trashed = await callRaw("POST", `/api/projects/${b}/trash`, {}, as(b));
    const trashBody = await trashed.json();
    expect(trashBody.currentId).toBe(a);
    expect(cookieOf(trashed)).toBe(a);
    const list = (await call("GET", "/api/projects", undefined, as(a))).body;
    expect(list.projects.map((p: { id: string }) => p.id)).toEqual([a]);
    expect(list.trashed.map((p: { id: string }) => p.id)).toEqual([b]);

    // Hidden, not removed (FR-059): its canvas is refused, its rows and the feedback link remain.
    expect((await call("GET", `/api/canvas?projectId=${b}`)).status).toBe(404);
    expect((await call("POST", `/api/nodes/${node}/ask`, { content: "x" })).status).toBe(404);
    expect(await db.selectFrom("nodes").select("id").where("id", "=", node).executeTakeFirst()).toBeDefined();
    expect((await call("GET", "/api/feedback")).body.items[0].context.elementId).toBe(fb.context.elementId);

    expect((await call("POST", `/api/projects/${b}/restore`, {})).body.project.trashedAt).toBeNull();
    expect(await canvasOf(b)).toEqual(before);
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
