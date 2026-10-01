import { sql } from "kysely";
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

  it("Feature 5 (reworked): suggested underlines need no AI call and store nothing", async () => {
    const t = await call("POST", "/api/trees", {});
    await call("POST", `/api/nodes/${t.body.node.id}/messages?wait=1`, { content: "Pods" });
    const provider = await import("@/server/ai/fake");
    expect("suggestSpans" in new provider.FakeAIProvider()).toBe(false);
    const { rows } = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'span_suggestions'`.execute(db);
    expect(rows[0].n).toBe(0);
    for (const file of files(path.join(root, "src"), /\.(ts|tsx)$/)) {
      const rel = path.relative(root, file);
      if (rel.startsWith("src/server/db/migrations/")) continue;
      expect(readFileSync(file, "utf8"), rel).not.toMatch(/span_suggestions|suggestSpans/);
    }
  });

  it("Feature 6, Articles I and VI: settings are user-authored instructions that tune nothing else", async () => {
    await call("PUT", "/api/settings", { informationPressure: 3, replyModel: "claude-sonnet-5" });
    const rows = await db.selectFrom("setting_changes").select("provenance").execute();
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.provenance === "user_authored")).toBe(true);

    for (const file of files(path.join(root, "src"), /\.(ts|tsx)$/)) {
      const src = readFileSync(file, "utf8");
      const rel = path.relative(root, file);
      // A reply's recorded level and model are never rewritten (FR-010, FR-019).
      expect(src, rel).not.toMatch(/updateTable\("messages"\)[\s\S]{0,300}?(pressure_level|reply_model)/);
      // Only the settings module reads the settings history (Article VI, 1.0.1).
      if (/setting_changes/.test(src)) expect(rel).toMatch(/^src\/server\/(settings|db)\//);
    }
    // Summaries and definitions never see the level or reply model (FR-007, FR-018).
    for (const dir of ["summaries", "definitions"]) {
      for (const file of files(path.join(root, "src/server", dir), /\.ts$/)) {
        expect(readFileSync(file, "utf8"), file).not.toMatch(/pressure|reply_model|replyModel/i);
      }
    }
  });

  it("Feature 8, Articles I, II and VI: parked tangents are user-authored, append-only and kept from the AI", async () => {
    const t = await call("POST", "/api/trees", {});
    const nodeId = t.body.node.id;
    const ai = (await call("POST", `/api/nodes/${nodeId}/messages?wait=1`, { content: "Pods" })).body.aiMessage;
    const start = ai.content.indexOf("Containers");
    const anchor = { messageId: ai.id, start, end: start + 10, text: "Containers", prefix: "", suffix: "" };
    const a = (await call("POST", `/api/nodes/${nodeId}/parked`, { ...anchor, question: "Why?" })).body.parked;
    const b = (await call("POST", `/api/nodes/${nodeId}/parked`, anchor)).body.parked;
    await call("POST", `/api/parked/${a.id}/question`, { question: "How?" });
    await call("POST", `/api/parked/${b.id}/discard`);
    await call("POST", `/api/parked/${a.id}/fire?wait=1`);

    const tangents = await db.selectFrom("parked_tangents").select("provenance").execute();
    const events = await db.selectFrom("parked_tangent_events").select("provenance").execute();
    expect(tangents.length).toBe(2);
    expect(events.length).toBe(4);
    expect([...tangents, ...events].every((r) => r.provenance === "user_authored")).toBe(true);

    const aiFree = ["src/server/ai", "src/server/summaries", "src/server/suggestions"];
    const aiFreeFiles = ["src/server/messages/replyInput.ts", "src/server/forest/forest.ts"];
    for (const file of files(path.join(root, "src"), /\.(ts|tsx)$/)) {
      const src = readFileSync(file, "utf8");
      const rel = path.relative(root, file);
      expect(src, rel).not.toMatch(/(updateTable|deleteFrom)\("parked_(tangents|tangent_events)"\)/);
      // Only the parked module, the schema and migrations touch the tables (research R9).
      if (/parked_tangent/.test(src)) expect(rel).toMatch(/^src\/server\/(parked|db)\//);
      // Parked questions reach the AI only once fired, as a message; the map never sees them.
      if (aiFree.some((d) => rel.startsWith(d + "/")) || aiFreeFiles.includes(rel)) {
        expect(src, rel).not.toMatch(/parked/i);
      }
    }
  });

  it("Feature 9, Articles I, II and VI: function outputs are AI-suggested, append-only and user-started", async () => {
    const t = await call("POST", "/api/trees", {});
    const nodeId = t.body.node.id;
    await call("POST", `/api/nodes/${nodeId}/messages?wait=1`, { content: "Pods" });
    await drainSummaries();
    const a = (await call("POST", `/api/nodes/${nodeId}/functions/analogy/run`)).body.output.id;
    const b = (await call("POST", `/api/nodes/${nodeId}/functions/analogy/run`)).body.output.id;
    const { version } = (await call("POST", `/api/nodes/${a}/output/regenerate`)).body;
    await call("POST", `/api/nodes/${a}/output/confirm`, { versionId: version.id });
    await call("POST", `/api/nodes/${b}/output/reject`);
    await call("PUT", "/api/kind-settings", { kind: "analogy", key: "reach", value: "far" });

    const versions = await db.selectFrom("function_output_versions").select("provenance").execute();
    expect(versions.length).toBe(3);
    expect(versions.every((v) => v.provenance === "ai_suggested")).toBe(true);
    const made = await db.selectFrom("nodes").select(["kind", "provenance"]).where("kind", "<>", "conversation").execute();
    expect(made.length).toBe(4);
    expect(made.every((n) => n.provenance === "ai_suggested")).toBe(true);
    const events = await db.selectFrom("function_output_events").select(["kind", "provenance"]).execute();
    expect(events.map((e) => [e.kind, e.provenance]).sort()).toEqual([
      ["confirmed", "user_confirmed"],
      ["rejected", "user_authored"],
    ]);
    // An output can never become a child (Article II, FR-017).
    await expect(
      sql`INSERT INTO nodes (tree_id, parent_id, provenance, kind, origin, function_id, function_version)
          VALUES (${t.body.tree.id}, ${nodeId}, 'ai_suggested', 'analogy', 'function', 'analogy', 1)`.execute(db),
    ).rejects.toThrow(/nodes_only_conversations_have_parents/);

    const conversationInserts = ["src/server/forest/trees.ts", "src/server/forest/branch.ts", "src/server/messages/quickBranch.ts"];
    for (const file of files(path.join(root, "src"), /\.(ts|tsx)$/)) {
      const src = readFileSync(file, "utf8");
      const rel = path.relative(root, file);
      // Output history, pipes and kind settings are never rewritten (FR-037).
      expect(src, rel).not.toMatch(
        /(updateTable|deleteFrom)\("(pipes|function_output_versions|function_output_events|kind_setting_changes|node_summaries)"\)/,
      );
      // Only the runner spends tokens on functions (FR-024), and only it makes non-conversation nodes.
      if (/\.complete\(/.test(src)) expect(rel).toMatch(/^src\/server\/(ai|functions)\//);
      if (/insertInto\("nodes"\)/.test(src)) {
        expect([...conversationInserts, "src/server/functions/runner.ts"], rel).toContain(rel);
        if (rel !== "src/server/functions/runner.ts") expect(src, rel).toMatch(/kind: "conversation"/);
      }
      // Saving a setting can never start a run (FR-032, SC-008).
      if (rel.startsWith("src/server/settings/")) expect(src, rel).not.toMatch(/from "\.\.\/functions/);
      // Only the settings module reads the kind-settings history (Article VI).
      if (/kind_setting_changes/.test(src)) expect(rel).toMatch(/^src\/server\/(settings|db)\//);
    }
  });
});
