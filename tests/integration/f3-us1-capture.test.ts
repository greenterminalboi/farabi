import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { call, createFeedback, newProject, startTree } from "./helpers";

const root = path.resolve(import.meta.dirname, "../..");

describe("US1: capture feedback from anywhere", () => {
  it("stores a text-only item as open, authored by the user", async () => {
    const res = await createFeedback({ text: "The Send button is hard to find", view: "map" });
    expect(res.status).toBe(201);
    const item = res.body.item;
    expect(item.state).toBe("open");
    expect(item.history).toHaveLength(1);
    expect(item.history[0]).toMatchObject({ state: "open", provenance: "user_authored" });
    expect(item.context).toEqual({ view: "map", nodeId: null, projectId: null, elementId: null, element: null });
    expect(item.tags).toEqual([]);
    expect(item.attachments).toEqual([]);
    const row = await db.selectFrom("feedback_items").selectAll().executeTakeFirstOrThrow();
    expect(row.provenance).toBe("user_authored");
  });

  it("records the open project and the focused element from the canvas (FR-058)", async () => {
    const projectId = await newProject();
    const tree = await startTree(projectId, "Pods");
    const res = await createFeedback({ text: "Reply overflows", view: "canvas", projectId, elementId: tree.answer.id });
    expect(res.status).toBe(201);
    expect(res.body.item.context).toMatchObject({
      view: "canvas",
      nodeId: null,
      projectId,
      elementId: tree.answer.id,
      element: { kind: "answer", excerpt: tree.answer.text.replace(/\s+/g, " ") },
    });
    const onlyProject = await createFeedback({ text: "Canvas is slow", view: "canvas", projectId });
    expect(onlyProject.body.item.context).toMatchObject({ projectId, elementId: null });
  });

  it("refuses an element outside the canvas, an unknown element or project, and blank text", async () => {
    const projectId = await newProject();
    const tree = await startTree(projectId, "Pods");
    expect((await createFeedback({ text: "x", view: "map", elementId: tree.edge.id })).status).toBe(422);
    expect((await createFeedback({ text: "x", view: "canvas", elementId: crypto.randomUUID() })).status).toBe(422);
    expect((await createFeedback({ text: "x", view: "canvas", projectId: crypto.randomUUID() })).status).toBe(422);
    const other = await newProject("Other");
    expect((await createFeedback({ text: "x", view: "canvas", projectId: other, elementId: tree.edge.id })).status).toBe(422);
    expect((await createFeedback({ text: "   \n\t ", view: "map" })).status).toBe(422);
    expect((await createFeedback({ text: "", view: "map" })).status).toBe(422);
    expect(await db.selectFrom("feedback_items").select("id").execute()).toHaveLength(0);
  });

  it("stores tags once per normalised key, keeping the first spelling", async () => {
    const res = await createFeedback({ text: "Tags", view: "map", tags: ["Map View", "map  view", " chat "] });
    expect(res.status).toBe(201);
    expect(res.body.item.tags).toEqual([
      { text: "Map View", key: "map view" },
      { text: "chat", key: "chat" },
    ]);
  });

  it("lists items newest first", async () => {
    await createFeedback({ text: "first", view: "map" });
    await createFeedback({ text: "second", view: "map" });
    const list = await call("GET", "/api/feedback");
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: { text: string }) => i.text)).toEqual(["second", "first"]);
  });

  it("works with the AI service unreachable (FR-021)", async () => {
    const saved = { provider: process.env.AI_PROVIDER, key: process.env.ANTHROPIC_API_KEY };
    process.env.AI_PROVIDER = "claude";
    process.env.ANTHROPIC_API_KEY = "";
    try {
      const t0 = Date.now();
      const res = await createFeedback({ text: "Offline", view: "map" });
      expect(res.status).toBe(201);
      expect(Date.now() - t0).toBeLessThan(1000);
    } finally {
      process.env.AI_PROVIDER = saved.provider;
      process.env.ANTHROPIC_API_KEY = saved.key;
    }
  });

  it("no feedback module imports the AI layer", () => {
    const dirs = ["src/server/feedback", "src/components/feedback", "src/app/api/feedback"];
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)],
      );
    for (const dir of dirs) {
      for (const file of files(path.join(root, dir))) {
        expect(readFileSync(file, "utf8"), file).not.toMatch(/from ["'](@\/server\/ai|\.\.\/ai)/);
      }
    }
  });
});
