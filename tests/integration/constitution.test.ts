import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { drainSummaries } from "@/server/summaries/queue";
import { call } from "./helpers";

const root = path.resolve(import.meta.dirname, "../..");

function files(dir: string, match: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full, match) : match.test(full) ? [full] : [];
  });
}

describe("constitution guards", () => {
  it("Article II: no DELETE or PATCH handlers anywhere in the API", () => {
    for (const file of files(path.join(root, "src/app/api"), /route\.ts$/)) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/export\s+(const|async function|function)\s+(DELETE|PATCH)\b/);
    }
  });

  it("Article I: every summary and AI message is ai_suggested", async () => {
    const t = await call("POST", "/api/trees", {});
    await call("POST", `/api/nodes/${t.body.node.id}/messages`, { content: "hi" });
    await drainSummaries();
    const summaries = await db.selectFrom("node_summaries").select("provenance").execute();
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries.every((s) => s.provenance === "ai_suggested")).toBe(true);
    const ai = await db.selectFrom("messages").select("provenance").where("role", "=", "ai").execute();
    expect(ai.every((m) => m.provenance === "ai_suggested")).toBe(true);
    const nodes = await db.selectFrom("nodes").select("provenance").execute();
    expect(nodes.every((n) => n.provenance === "user_authored")).toBe(true);
  });

  it("Article IV: only message services call provider.reply; no AI module creates nodes", () => {
    const server = files(path.join(root, "src/server"), /\.ts$/);
    const callers = server.filter((f) => /\.reply\(/.test(readFileSync(f, "utf8")));
    expect(callers.length).toBeGreaterThan(0);
    for (const f of callers) expect(path.relative(root, f)).toMatch(/^src\/server\/(messages|ai)\//);
    for (const f of files(path.join(root, "src/server/ai"), /\.ts$/)) {
      expect(readFileSync(f, "utf8")).not.toMatch(/insertInto\("nodes"\)|insertInto\("branch_markers"\)/);
    }
  });
});
