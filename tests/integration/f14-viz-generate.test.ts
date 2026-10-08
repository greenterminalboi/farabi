// Feature 014 · POST /api/viz/generate (contracts/http-api.md): validates, checks the provider first,
// marks results AI-suggested, fails cleanly, and writes nothing in any case.
import { sql } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getFakeCalls, registerFakeCompletion, resetFakeCalls, setFakeMode } from "@/server/ai/fake";
import { db } from "@/server/db/client";
import { setConfig } from "@/server/settings/config";
import { installVizFakes, VIZ_TAG } from "@/server/viz";
import { parseScene } from "@/viz";
import { call } from "./helpers";

async function rowCounts() {
  const { rows } = await sql<{ n: string }>`
    SELECT (SELECT count(*) FROM nodes) + (SELECT count(*) FROM trees) + (SELECT count(*) FROM projects)
         + (SELECT count(*) FROM setting_changes) AS n`.execute(db);
  return Number(rows[0].n);
}

describe("Feature 014 · generate route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    installVizFakes(true);
  });

  it("returns an AI-suggested scene and writes nothing", async () => {
    const before = await rowCounts();
    const res = await call("POST", "/api/viz/generate", { text: "for (let i = 0; i < 3; i++) {\n  sum += i;\n}", family: "auto", model: "default" });
    expect(res.status).toBe(200);
    expect(res.body.scene).toMatchObject({ version: 1, family: "code", origin: "ai-suggested" });
    expect(parseScene(res.body.scene).ok).toBe(true);
    expect(getFakeCalls().lastComplete).toMatchObject({ tag: VIZ_TAG, model: null });
    expect(await rowCounts()).toBe(before);
  });

  it("passes a chosen model", async () => {
    expect((await call("POST", "/api/viz/generate", { text: "a vs b", model: "claude-haiku-4-5" })).status).toBe(200);
    expect(getFakeCalls().lastComplete!.model).toBe("claude-haiku-4-5");
  });

  it("refuses bad bodies before any AI call", async () => {
    resetFakeCalls();
    for (const body of [{}, { text: "" }, { text: "   " }, { text: "x".repeat(20_001) }, { text: "x", family: "poem" }, { text: "x", model: "gpt" }]) {
      const res = await call("POST", "/api/viz/generate", body);
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(422);
      expect(res.body.error.code).toBe("invalid_request");
    }
    expect(getFakeCalls().completeInputs).toHaveLength(0);
  });

  it("answers provider_not_ready without an AI call when the provider can't run", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await setConfig("ai_provider", "claude");
    resetFakeCalls();
    const res = await call("POST", "/api/viz/generate", { text: "a vs b" });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: { code: "provider_not_ready" }, provider: "claude", reason: "no_api_key", settingsPath: "/settings#provider" });
    expect(getFakeCalls().completeInputs).toHaveLength(0);
  });

  it("503 viz_unavailable when the provider fails or both replies are invalid, nothing written", async () => {
    const before = await rowCounts();
    setFakeMode({ mode: "fail" });
    let res = await call("POST", "/api/viz/generate", { text: "a vs b" });
    expect(res.status).toBe(503);
    expect(res.body.error).toEqual({ code: "viz_unavailable", message: "The AI couldn't produce a usable visualization. Nothing was created. Try again." });
    setFakeMode({ mode: "ok" });
    registerFakeCompletion(VIZ_TAG, () => "no json here");
    resetFakeCalls();
    res = await call("POST", "/api/viz/generate", { text: "a vs b" });
    expect(res.status).toBe(503);
    expect(getFakeCalls().completeInputs).toHaveLength(2);
    expect(await rowCounts()).toBe(before);
  });
});
