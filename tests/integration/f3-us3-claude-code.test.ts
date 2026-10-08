import { chmodSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { regenerateFeedbackFile } from "@/server/feedback/exportFile";
import { feedbackDir, feedbackFilePath } from "@/server/feedback/paths";
import { markAddressed } from "@/server/feedback/state";
import { PNG_1PX } from "./fixtures";
import { call, newProject, startTree, createFeedback, readFeedbackFile } from "./helpers";


async function snapshot(id: string) {
  const [item, tags, attachments, events] = await Promise.all([
    db.selectFrom("feedback_items").selectAll().where("id", "=", id).execute(),
    db.selectFrom("feedback_tags").selectAll().where("item_id", "=", id).execute(),
    db.selectFrom("feedback_attachments").selectAll().where("item_id", "=", id).execute(),
    db.selectFrom("feedback_state_events").selectAll().where("item_id", "=", id).orderBy("created_at").execute(),
  ]);
  return { item, tags, attachments, events };
}

describe("US3: Claude Code reads and acts on feedback", () => {
  it("regenerates FEEDBACK.md on create with everything needed to act on the item", async () => {
    const projectId = await newProject();
    const tree = await startTree(projectId, "Pods please");
    const elementId = tree.edge.id;
    const res = await createFeedback({
      text: "Edge labels overlap\nafter dragging",
      view: "canvas",
      elementId,
      tags: ["map", "layout"],
      images: [{ bytes: PNG_1PX }],
    });
    const item = res.body.item;
    const saved = Date.now();
    const file = await readFeedbackFile();
    expect(Date.now() - statSync(feedbackFilePath()).mtimeMs).toBeLessThan(1000 + (Date.now() - saved)); // SC-004
    expect(file).toContain(`### ${item.id}`);
    expect(file).toContain("> Edge labels overlap\n> after dragging");
    expect(file).toContain("- Tags: map, layout");
    expect(file).toContain(`view: canvas · project: ${projectId} · element: ${elementId} (question: "Pods please")`);
    expect(file).toContain(`  - ${item.attachments[0].path}`);
    expect(file).toMatch(/1 open · 0 addressed · 0 resolved/);
  });

  it("markAddressed moves only open items, once, and never touches content (SC-007)", async () => {
    const { id } = (await createFeedback({ text: "Fix me", view: "map", tags: ["x"], images: [{ bytes: PNG_1PX }] })).body.item;
    const before = await snapshot(id);

    expect(await markAddressed(id)).toBe("addressed");
    const after = await snapshot(id);
    expect(after.item).toEqual(before.item);
    expect(after.tags).toEqual(before.tags);
    expect(after.attachments).toEqual(before.attachments);
    expect(after.events).toHaveLength(2);
    expect(after.events.at(-1)).toMatchObject({ state: "addressed", provenance: "ai_suggested" });
    const file = await readFeedbackFile();
    expect(file.indexOf(`### ${id}`)).toBeGreaterThan(file.indexOf("## Addressed"));

    expect(await markAddressed(id)).toBe("not_open");
    expect((await snapshot(id)).events).toHaveLength(2);

    await call("POST", `/api/feedback/${id}/resolve`, {});
    expect(await markAddressed(id)).toBe("not_open");
    expect((await snapshot(id)).events).toHaveLength(3);

    expect(await markAddressed(crypto.randomUUID())).toBe("not_found");
    expect(await markAddressed("not-a-uuid")).toBe("not_found");
  });

  // The real script's exit codes run against an on-disk store in tests/store/f11-cli-closed.test.ts
  // (a separate process can't open this suite's in-memory store), and against the running app in
  // e2e (tests/e2e/f3-us4-resolve.spec.ts).

  it("concurrent regenerations leave one complete file", async () => {
    for (let i = 0; i < 5; i++) await createFeedback({ text: `item ${i}`, view: "map" });
    await Promise.all(Array.from({ length: 6 }, () => regenerateFeedbackFile()));
    const file = await readFeedbackFile();
    expect(file.match(/^### /gm)).toHaveLength(5);
    expect(file.endsWith("\n")).toBe(true);
  });

  it("a failed write keeps the previous file and never fails the request", async () => {
    await createFeedback({ text: "before", view: "map" });
    const previous = await readFeedbackFile();
    chmodSync(feedbackDir(), 0o500);
    try {
      const res = await createFeedback({ text: "while unwritable", view: "map" });
      expect(res.status).toBe(201);
    } finally {
      chmodSync(feedbackDir(), 0o755);
    }
    expect(await readFeedbackFile()).toBe(previous);
  });
});
