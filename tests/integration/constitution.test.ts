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
    await call("POST", `/api/nodes/${t.body.node.id}/messages?wait=1`, { content: "hi" });
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

  it("Article II: nothing updates a node's parent after it is created (drags never re-parent)", () => {
    for (const file of files(path.join(root, "src"), /\.(ts|tsx)$/)) {
      const src = readFileSync(file, "utf8");
      const updatesNodes = /updateTable\("nodes"\)[\s\S]{0,200}?\.set\(\{[^}]*parent_id/.test(src);
      expect(updatesNodes, file).toBe(false);
      expect(src, file).not.toMatch(/UPDATE\s+nodes\s+SET[^;]*parent_id/i);
    }
  });

  it("Articles I and VI: definition and edge-label history is typed and append-only", async () => {
    const t = await call("POST", "/api/trees", {});
    const ai = (await call("POST", `/api/nodes/${t.body.node.id}/messages?wait=1`, { content: "Pods" })).body.aiMessage;
    const start = ai.content.indexOf("Containers");
    const sel = { nodeId: t.body.node.id, messageId: ai.id, start, end: start + 10, text: "Containers" };
    const def = (await call("POST", "/api/definitions", sel)).body.definition;
    const { drainDrafts } = await import("@/server/definitions/draftQueue");
    await drainDrafts();
    await call("POST", `/api/definitions/${def.id}/confirm`, {});
    const branch = await call("POST", `/api/nodes/${t.body.node.id}/branches`, { ...sel, prefix: "", suffix: "" });
    await call("PUT", `/api/nodes/${branch.body.node.id}/edge-label`, { text: "builds on" });

    const versions = await db.selectFrom("definition_versions").select("provenance").orderBy("created_at").execute();
    expect(versions.map((v) => v.provenance)).toEqual(["ai_suggested", "user_confirmed"]);
    const labels = await db.selectFrom("edge_label_versions").select("provenance").execute();
    expect(labels.every((l) => l.provenance === "user_authored")).toBe(true);
    // No update or delete statements touch the version tables.
    for (const file of files(path.join(root, "src/server"), /\.ts$/)) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/(updateTable|deleteFrom)\("(definition_versions|edge_label_versions)"\)/);
    }
  });

  it("Feature 5, Articles I and II: suggestions are ai_suggested, insert-only and stay out of the structure", async () => {
    const t = await call("POST", "/api/trees", {});
    await call("POST", `/api/nodes/${t.body.node.id}/messages?wait=1`, { content: "Pods" });
    await call("POST", `/api/nodes/${t.body.node.id}/suggestions`, {});
    const rows = await db.selectFrom("span_suggestions").select("provenance").execute();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.provenance === "ai_suggested")).toBe(true);

    for (const file of files(path.join(root, "src"), /\.(ts|tsx)$/)) {
      const src = readFileSync(file, "utf8");
      const rel = path.relative(root, file);
      expect(src, rel).not.toMatch(/(updateTable|deleteFrom)\("span_suggestions"\)/);
      // Only the suggestions module, the schema and migrations know the cache exists (FR-006).
      if (/span_suggestions/.test(src)) expect(rel).toMatch(/^src\/server\/(suggestions|db)\//);
    }
    for (const file of files(path.join(root, "src/server/suggestions"), /\.ts$/)) {
      expect(readFileSync(file, "utf8")).not.toMatch(
        /insertInto\("(nodes|branch_markers|definitions|definition_versions|messages|node_summaries|edge_label_versions)"\)/,
      );
    }
  });
});
