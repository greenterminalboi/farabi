import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { call, createFeedback } from "./helpers";

const root = path.resolve(import.meta.dirname, "../..");

describe("US1: capture feedback from anywhere", () => {
  it("stores a text-only item as open, authored by the user", async () => {
    const res = await createFeedback({ text: "The Send button is hard to find", view: "map" });
    expect(res.status).toBe(201);
    const item = res.body.item;
    expect(item.state).toBe("open");
    expect(item.history).toHaveLength(1);
    expect(item.history[0]).toMatchObject({ state: "open", provenance: "user_authored" });
    expect(item.context).toEqual({ view: "map", nodeId: null });
    expect(item.tags).toEqual([]);
    expect(item.attachments).toEqual([]);
    const row = await db.selectFrom("feedback_items").selectAll().executeTakeFirstOrThrow();
    expect(row.provenance).toBe("user_authored");
  });

  it("records the open node when captured from a conversation", async () => {
    const tree = await call("POST", "/api/trees", {});
    const nodeId = tree.body.node.id;
    const res = await createFeedback({ text: "Reply overflows", view: "chat", nodeId });
    expect(res.status).toBe(201);
    expect(res.body.item.context).toEqual({ view: "chat", nodeId });
  });

  it("refuses a node outside the chat view, an unknown node, and blank text", async () => {
    const tree = await call("POST", "/api/trees", {});
    expect((await createFeedback({ text: "x", view: "map", nodeId: tree.body.node.id })).status).toBe(422);
    expect((await createFeedback({ text: "x", view: "chat", nodeId: crypto.randomUUID() })).status).toBe(422);
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
