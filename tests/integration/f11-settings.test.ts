// App settings that used to be environment variables (feature 11, US4, data-model.md §3).
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { getConfig, resolveConfig } from "@/server/settings/config";
import { call } from "./helpers";

const put = (key: string, value: unknown) => call("PUT", "/api/settings/app", { key, value });

describe("Feature 11 · US4 app settings", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("resolves a stored row, then the environment, then the default", async () => {
    vi.stubEnv("AI_PROVIDER", "");
    expect(resolveConfig("ai_provider")).toEqual({ value: "fake", source: "default", changedAt: null });
    vi.stubEnv("AI_PROVIDER", "claude-code");
    expect(resolveConfig("ai_provider")).toMatchObject({ value: "claude-code", source: "env" });
    expect((await put("ai_provider", "fake")).status).toBe(200);
    expect(resolveConfig("ai_provider")).toMatchObject({ value: "fake", source: "row" });
    expect(resolveConfig("ai_provider").changedAt).toMatch(/^\d{4}-/);

    vi.stubEnv("SUMMARY_TRIGGER", "map");
    expect(getConfig("summary_trigger")).toBe("map");
    vi.stubEnv("SUMMARY_TRIGGER", "");
    expect(resolveConfig("summary_trigger")).toEqual({ value: "reply", source: "default", changedAt: null });

    // The default model follows the provider in effect: CLAUDE_MODEL or CLAUDE_CODE_MODEL.
    vi.stubEnv("CLAUDE_MODEL", "claude-a");
    vi.stubEnv("CLAUDE_CODE_MODEL", "claude-b");
    await put("ai_provider", "claude-code");
    expect(getConfig("default_model")).toBe("claude-b");
    await put("default_model", "claude-c");
    expect(getConfig("default_model")).toBe("claude-c");
    // null goes back to the default, ignoring the env.
    await put("default_model", null);
    expect(resolveConfig("default_model")).toMatchObject({ value: null, source: "row" });
  });

  it("ignores the environment in the desktop app", async () => {
    vi.stubEnv("FARABI_HOST", "tauri");
    vi.stubEnv("AI_PROVIDER", "claude-code");
    vi.stubEnv("FEEDBACK_DIR", "/somewhere");
    expect(resolveConfig("ai_provider")).toEqual({ value: "fake", source: "default", changedAt: null });
    expect(getConfig("feedback_export_dir")).toBeNull();
  });

  it("appends a user-authored row per change, and none for an unchanged value", async () => {
    // "Unchanged" compares with the value in effect, so a developer's SUMMARY_TRIGGER=map would hide the first row.
    vi.stubEnv("SUMMARY_TRIGGER", "");
    await put("summary_trigger", "map");
    await put("summary_trigger", "map");
    await put("summary_trigger", "reply");
    const rows = await db.selectFrom("setting_changes").select(["key", "value", "provenance"]).where("key", "=", "summary_trigger").orderBy("created_at").execute();
    expect(rows).toEqual([
      { key: "summary_trigger", value: "map", provenance: "user_authored" },
      { key: "summary_trigger", value: "reply", provenance: "user_authored" },
    ]);
  });

  it("rejects invalid values, in the API and in the database", async () => {
    expect((await put("ai_provider", "gpt")).status).toBe(422);
    expect((await put("summary_trigger", "never")).status).toBe(422);
    expect((await put("no_such_key", 1)).status).toBe(422);
    await expect(
      sql`INSERT INTO setting_changes (key, value) VALUES ('ai_provider', '"gpt"'::jsonb)`.execute(db),
    ).rejects.toThrow(/setting_changes_ai_provider_check/);
    await expect(
      sql`INSERT INTO setting_changes (key, value) VALUES ('feedback_export_dir', '3'::jsonb)`.execute(db),
    ).rejects.toThrow(/setting_changes_path_check/);
  });

  it("needs an existing, writable folder for the feedback export, and writes FEEDBACK.md there", async () => {
    const missing = await put("feedback_export_dir", "/no/such/folder");
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe("folder_not_writable");
    expect((await put("feedback_export_dir", "relative/folder")).body.error.code).toBe("folder_not_writable");

    const dir = mkdtempSync(path.join(os.tmpdir(), "farabi-export-"));
    try {
      const ok = await put("feedback_export_dir", dir);
      expect(ok.status).toBe(200);
      expect(ok.body.exportStatus).toMatchObject({ ok: true, dir });
      const { readFile } = await import("node:fs/promises");
      expect(await readFile(path.join(dir, "FEEDBACK.md"), "utf8")).toContain("# Farabi feedback");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns every key as { value, source, changedAt }", async () => {
    const res = await call("GET", "/api/settings/app");
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("web");
    expect(Object.keys(res.body.config).sort()).toEqual(["ai_provider", "claude_code_path", "default_model", "feedback_export_dir", "lexicon_autodetect", "summary_trigger"]);
    for (const v of Object.values(res.body.config)) expect(Object.keys(v as object).sort()).toEqual(["changedAt", "source", "value"]);
  });
});
