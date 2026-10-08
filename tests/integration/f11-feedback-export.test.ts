// Feedback export to a chosen folder, with attachments mirrored (feature 11, US5, T066).
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachmentAbsPath } from "@/server/feedback/paths";
import { setConfig } from "@/server/settings/config";
import { PNG_1PX } from "./fixtures";
import { call, createFeedback } from "./helpers";

const tmp = (name: string) => mkdtempSync(path.join(os.tmpdir(), `farabi-${name}-`));

describe("Feature 11 · US5 feedback export", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("stores attachments in the data folder in the desktop app, and mirrors them on export", async () => {
    const dataDir = tmp("data");
    const exportDir = tmp("export");
    try {
      vi.stubEnv("FARABI_HOST", "tauri");
      vi.stubEnv("FARABI_DATA_DIR", dataDir);
      // Export is off until a folder is chosen.
      const res = await createFeedback({ text: "The minimap jumps", view: "canvas", images: [{ bytes: PNG_1PX }] });
      expect(res.status).toBe(201);
      const stored = res.body.item.attachments[0].path as string;
      expect(path.resolve(stored).startsWith(path.join(dataDir, "feedback", "attachments"))).toBe(true);
      expect(existsSync(path.join(exportDir, "FEEDBACK.md"))).toBe(false);

      await setConfig("feedback_export_dir", exportDir);
      await createFeedback({ text: "Second item", view: "canvas" });
      const file = readFileSync(path.join(exportDir, "FEEDBACK.md"), "utf8");
      expect(file).toContain("The minimap jumps");
      const id = res.body.item.id as string;
      const mirrored = path.join(exportDir, "attachments", id);
      expect(existsSync(mirrored)).toBe(true);
      const [name] = (await import("node:fs")).readdirSync(mirrored).filter((n) => !n.includes(".thumb."));
      expect(readFileSync(path.join(mirrored, name))).toEqual(Buffer.from(PNG_1PX));
      // FEEDBACK.md points at the mirror, not into the app's data folder.
      expect(file).toContain(path.join(mirrored, name));
      expect(file).not.toContain(dataDir);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(exportDir, { recursive: true, force: true });
    }
  });

  it("saves the item when the export folder is gone, and reports the error in Settings", async () => {
    const exportDir = tmp("gone");
    await setConfig("feedback_export_dir", exportDir);
    rmSync(exportDir, { recursive: true, force: true });
    const res = await createFeedback({ text: "Saved anyway", view: "canvas" });
    expect(res.status).toBe(201);
    expect((await call("GET", "/api/feedback")).body.items.map((i: { text: string }) => i.text)).toContain("Saved anyway");
    const settings = await call("GET", "/api/settings/app");
    expect(settings.body.exportStatus).toMatchObject({ ok: false, dir: exportDir });
    expect(settings.body.exportStatus.error).toMatch(/doesn't exist/);
    expect(existsSync(exportDir)).toBe(false);
  });

  it("lets only the CLI's bearer mark an item addressed, and only in the desktop app", async () => {
    const { setSession } = await import("@/server/host/session");
    const secret = "C".repeat(43);
    setSession({ secret, port: 3000 });
    const id = (await createFeedback({ text: "Fix the minimap", view: "canvas" })).body.item.id as string;
    const route = `/api/feedback/${id}/addressed`;
    expect((await call("POST", route, undefined, { authorization: `Bearer ${secret}` })).status).toBe(404);
    vi.stubEnv("FARABI_HOST", "tauri");
    expect((await call("POST", route, undefined, { cookie: `farabi_session=${secret}` })).status).toBe(404);
    expect((await call("POST", route, undefined, { authorization: "Bearer wrong" })).status).toBe(404);
    const ok = await call("POST", route, undefined, { authorization: `Bearer ${secret}` });
    expect(ok).toEqual({ status: 200, body: { result: "addressed" } });
    const again = await call("POST", route, undefined, { authorization: `Bearer ${secret}` });
    expect(again).toEqual({ status: 409, body: { result: "not_open", state: "addressed" } });
  });

  it("refuses stored paths that leave the feedback folder", () => {
    expect(() => attachmentAbsPath("../../etc/passwd")).toThrow(/outside the feedback folder/);
    expect(() => attachmentAbsPath("/etc/passwd")).toThrow(/outside the feedback folder/);
    expect(attachmentAbsPath("attachments/x/y.png")).toMatch(/attachments\/x\/y\.png$/);
  });
});
