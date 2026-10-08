// AI actions without a usable provider explain themselves and write nothing (feature 11, FR-014).
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteClaudeCodeRun, resetClaudeCodeStatus } from "@/server/ai/claudeCodeDiscovery";
import { db } from "@/server/db/client";
import { setConfig } from "@/server/settings/config";
import { call, newProject, startTree } from "./helpers";

const ID = "00000000-0000-4000-8000-000000000000";

async function counts() {
  // Edges and answers are both rows in `nodes` (feature 10's message graph).
  const { rows } = await sql<{ nodes: string; trees: string; defs: string; versions: string }>`
    SELECT (SELECT count(*) FROM nodes) AS nodes, (SELECT count(*) FROM trees) AS trees,
           (SELECT count(*) FROM definitions) AS defs, (SELECT count(*) FROM definition_versions) AS versions`.execute(db);
  return rows[0];
}

/** Every route that starts AI work, with ids that exist where it matters. */
async function aiRoutes(): Promise<Array<[string, string, unknown]>> {
  const projectId = await newProject();
  const { edge, answer } = await startTree(projectId, "Pods");
  return [
    ["POST", "/api/trees", { projectId, content: "Another question" }],
    ["POST", `/api/nodes/${answer.id}/ask`, { content: "Why?" }],
    ["POST", `/api/edges/${ID}/send`, { content: "Send this" }],
    ["POST", `/api/edges/${edge.id}/attempts`, { mode: "regenerate" }],
    ["POST", `/api/nodes/${answer.id}/functions/analogy/run`, undefined],
    ["POST", `/api/edges/${ID}/rerun`, undefined],
    ["POST", "/api/definitions", { nodeId: answer.id, start: 0, end: 3, text: String(answer.text).slice(0, 3) }],
    ["POST", `/api/definitions/${ID}/redraft`, undefined],
    ["POST", `/api/parked/${ID}/fire`, undefined],
  ];
}

async function expectRefused(reason: string, provider: string, choose: () => Promise<void>) {
  const routes = await aiRoutes();
  await choose();
  const before = await counts();
  for (const [method, route, body] of routes) {
    const res = await call(method, route, body);
    expect(res.status, `${method} ${route}`).toBe(422);
    expect(res.body).toMatchObject({ error: { code: "provider_not_ready" }, provider, reason, settingsPath: "/settings#provider" });
  }
  expect(await counts()).toEqual(before);
}

describe("Feature 11 · US4 provider readiness", () => {
  beforeEach(() => resetClaudeCodeStatus());
  afterEach(() => {
    vi.unstubAllEnvs();
    resetClaudeCodeStatus();
    noteClaudeCodeRun("ok");
  });

  it("refuses with no_api_key when the Claude API has no key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expectRefused("no_api_key", "claude", async () => void (await setConfig("ai_provider", "claude")));
  });

  it("refuses with claude_code_not_found when Claude Code can't be found", async () => {
    await expectRefused("claude_code_not_found", "claude-code", async () => {
      await setConfig("claude_code_path", "/no/such/claude");
      await setConfig("ai_provider", "claude-code");
    });
  });

  it("refuses with claude_code_signed_out after a run reported an auth error", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "farabi-claude-"));
    const bin = path.join(dir, "claude");
    writeFileSync(bin, "#!/bin/sh\necho '2.1.283 (Claude Code)'\n");
    chmodSync(bin, 0o755);
    await expectRefused("claude_code_signed_out", "claude-code", async () => {
      await setConfig("claude_code_path", bin);
      await setConfig("ai_provider", "claude-code");
      noteClaudeCodeRun("auth_error");
    });
  });

  it("lets the fake provider through", async () => {
    await setConfig("ai_provider", "fake");
    const projectId = await newProject();
    expect((await call("POST", "/api/trees?wait=1", { projectId, content: "Pods" })).status).toBe(201);
  });
});
