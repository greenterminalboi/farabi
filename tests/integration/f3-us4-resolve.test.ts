import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { markAddressed } from "@/server/feedback/state";
import { call, createFeedback, readFeedbackFile } from "./helpers";

const root = path.resolve(import.meta.dirname, "../..");
const newItem = async () => (await createFeedback({ text: "Review me", view: "map" })).body.item.id as string;

describe("US4: confirm or reopen", () => {
  it("resolves an addressed item as user_confirmed", async () => {
    const id = await newItem();
    await markAddressed(id);
    const res = await call("POST", `/api/feedback/${id}/resolve`, {});
    expect(res.status).toBe(200);
    expect(res.body.item.state).toBe("resolved");
    expect(res.body.item.history.at(-1)).toMatchObject({ state: "resolved", provenance: "user_confirmed" });
  });

  it("resolves directly from open (FR-014) and refuses to resolve twice", async () => {
    const id = await newItem();
    expect((await call("POST", `/api/feedback/${id}/resolve`, {})).status).toBe(200);
    const again = await call("POST", `/api/feedback/${id}/resolve`, {});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("invalid_transition");
  });

  it("reopens from resolved and from addressed, and refuses to reopen an open item", async () => {
    const a = await newItem();
    await call("POST", `/api/feedback/${a}/resolve`, {});
    const reopened = await call("POST", `/api/feedback/${a}/reopen`, {});
    expect(reopened.status).toBe(200);
    expect(reopened.body.item.history.at(-1)).toMatchObject({ state: "open", provenance: "user_authored" });

    const b = await newItem();
    await markAddressed(b);
    expect((await call("POST", `/api/feedback/${b}/reopen`, {})).body.item.state).toBe("open");

    const c = await newItem();
    expect((await call("POST", `/api/feedback/${c}/reopen`, {})).status).toBe(409);
    expect((await call("POST", `/api/feedback/${crypto.randomUUID()}/reopen`, {})).status).toBe(404);
  });

  it("keeps every transition in order with its own time (SC-005)", async () => {
    const id = await newItem();
    await markAddressed(id);
    await call("POST", `/api/feedback/${id}/resolve`, {});
    const item = (await call("POST", `/api/feedback/${id}/reopen`, {})).body.item;
    expect(item.history.map((e: { state: string }) => e.state)).toEqual(["open", "addressed", "resolved", "open"]);
    expect(item.history.map((e: { provenance: string }) => e.provenance)).toEqual([
      "user_authored",
      "ai_suggested",
      "user_confirmed",
      "user_authored",
    ]);
    const times = item.history.map((e: { at: string }) => Date.parse(e.at));
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    expect(new Set(item.history.map((e: { at: string }) => e.at)).size).toBe(4);

    const file = await readFeedbackFile();
    const section = file.slice(file.indexOf(`### ${id}`));
    expect(section.match(/^ {2}- \S+ (open|addressed|resolved) \(/gm)).toHaveLength(4);
  });

  it("no app route can set `addressed`", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)],
      );
    for (const file of files(path.join(root, "src/app/api/feedback"))) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/addressed|markAddressed/);
    }
  });
});
