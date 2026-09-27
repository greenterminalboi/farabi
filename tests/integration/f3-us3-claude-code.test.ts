import { execFile } from "node:child_process";
import { chmodSync, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { regenerateFeedbackFile } from "@/server/feedback/exportFile";
import { feedbackDir, feedbackFilePath } from "@/server/feedback/paths";
import { markAddressed } from "@/server/feedback/state";
import { PNG_1PX } from "./fixtures";
import { call, createFeedback, readFeedbackFile } from "./helpers";

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "../..");

/** Runs the real script against the test database; resolves with its exit code and output. */
async function script(...args: string[]): Promise<{ code: number; stdout: string }> {
  try {
    const { stdout } = await run("npx", ["tsx", "scripts/feedback-addressed.ts", ...args], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, FEEDBACK_DIR: feedbackDir() },
    });
    return { code: 0, stdout };
  } catch (err) {
    const e = err as { code: number; stdout: string };
    return { code: e.code, stdout: e.stdout };
  }
}

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
    const tree = await call("POST", "/api/trees", {});
    const nodeId = tree.body.node.id;
    const res = await createFeedback({
      text: "Edge labels overlap\nafter dragging",
      view: "chat",
      nodeId,
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
    expect(file).toContain(`view: chat · node: ${nodeId} ("New conversation")`);
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

  it("the real script exits 0, 2, 3 and 1 as documented", async () => {
    const { id } = (await createFeedback({ text: "Script me", view: "map" })).body.item;
    const first = await script(id);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain(`Marked ${id} addressed.`);
    const again = await script(id);
    expect(again.code).toBe(2);
    expect(again.stdout).toContain("is addressed; only open items can be marked addressed. No change.");
    expect((await script(crypto.randomUUID())).code).toBe(3);
    expect((await script("not-a-uuid")).code).toBe(1);
    expect((await script(id, "--state=resolved")).code).toBe(1);
    const events = await db
      .selectFrom("feedback_state_events")
      .select("state")
      .where("item_id", "=", id)
      .orderBy("created_at")
      .execute();
    expect(events.map((e) => e.state)).toEqual(["open", "addressed"]);
    expect(await readFeedbackFile()).toMatch(/0 open · 1 addressed · 0 resolved/);
  }, 60_000);

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
