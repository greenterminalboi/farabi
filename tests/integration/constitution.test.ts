import { sql } from "kysely";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { drainDrafts } from "@/server/definitions/draftQueue";
import { allKinds } from "@/shared/kinds";
import { seedV1 } from "./fixtures";
import { askAndWait, call, newProject, startTree } from "./helpers";

const root = path.resolve(import.meta.dirname, "../..");

function files(dir: string, match: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full, match) : match.test(full) ? [full] : [];
  });
}

const sources = () =>
  files(path.join(root, "src"), /\.(ts|tsx)$/).map((file) => ({ rel: path.relative(root, file), src: readFileSync(file, "utf8") }));

function spanOf(text: string, phrase: string) {
  const start = text.indexOf(phrase);
  return { start, end: start + phrase.length, text: phrase };
}

describe("constitution guards (Feature 10)", () => {
  it("1. Article II: no DELETE or PATCH handlers anywhere in the API", () => {
    for (const file of files(path.join(root, "src/app/api"), /route\.ts$/)) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/export\s+(const|async function|function)\s+(DELETE|PATCH)\b/);
    }
  });

  it("2. Article II, FR-008: nodes_guard allows only send, checkpoint, finalize and placement", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    const branch = (await call("POST", `/api/nodes/${t.answer.id}/branches`, spanOf(t.answer.text, "Containers"))).body.edge;
    const id = (x: string) => x;

    // Send once: allowed; send twice: refused.
    await sql`UPDATE nodes SET text = 'first', sent_at = now() WHERE id = ${id(branch.id)}`.execute(db);
    await expect(sql`UPDATE nodes SET text = 'second' WHERE id = ${id(branch.id)}`.execute(db)).rejects.toThrow();
    // Text after finalize: refused.
    await expect(sql`UPDATE nodes SET text = 'rewritten' WHERE id = ${id(t.answer.id)}`.execute(db)).rejects.toThrow();
    await expect(sql`UPDATE nodes SET status = 'pending' WHERE id = ${id(t.answer.id)}`.execute(db)).rejects.toThrow();
    // Structure and provenance: refused.
    for (const change of [
      sql`parent_id = ${t.edge.id}`,
      sql`kind = 'analogy'`,
      sql`anchor_start = 0`,
      sql`provenance = 'user_confirmed'`,
      sql`tree_id = tree_id, origin = 'ask'`,
    ]) {
      await expect(sql`UPDATE nodes SET ${change} WHERE id = ${id(branch.id)}`.execute(db)).rejects.toThrow();
    }
    // Any delete: refused.
    await expect(sql`DELETE FROM nodes WHERE id = ${id(t.answer.id)}`.execute(db)).rejects.toThrow(/cannot be deleted/);
    // Placement: allowed.
    await sql`UPDATE nodes SET manual_x = 1, manual_y = 2 WHERE id = ${id(t.answer.id)}`.execute(db);
    // A content node's parent must be an edge.
    await expect(
      sql`INSERT INTO nodes (project_id, tree_id, parent_id, kind, shape, origin, provenance, text, status)
          VALUES (${projectId}, ${t.tree.id}, ${t.answer.id}, 'answer', 'node', 'reply', 'ai_suggested', '', 'pending')`.execute(db),
    ).rejects.toThrow(/parent must be an edge/);
  });

  it("3. Article II, SC-003: frozen v1 rows can't be updated or deleted", async () => {
    const projectId = await newProject();
    const treeId = crypto.randomUUID();
    const nodeId = crypto.randomUUID();
    await seedV1({
      trees: [{ id: treeId, project_id: projectId, root_node_id: nodeId, layout_origin_x: 0, layout_origin_y: 0 }],
      nodes: [{ id: nodeId, tree_id: treeId, parent_id: null, provenance: "user_authored", manual_x: null, manual_y: null, kind: "conversation", origin: "root", function_id: null, function_version: null }],
    });
    await expect(sql`UPDATE v1.nodes SET manual_x = 1, manual_y = 1 WHERE id = ${nodeId}`.execute(db)).rejects.toThrow(/frozen v1 data/);
    await expect(sql`DELETE FROM v1.nodes WHERE id = ${nodeId}`.execute(db)).rejects.toThrow(/frozen v1 data/);
    await expect(sql`UPDATE v1.trees SET user_placed = true WHERE id = ${treeId}`.execute(db)).rejects.toThrow(/frozen v1 data/);
  });

  it("4. research R2: only the converter and migration 0010 read the v1 schema", () => {
    for (const { rel, src } of sources()) {
      if (rel.startsWith("src/server/db/v1/") || rel === "src/server/db/migrations/0010_message_graph.ts") continue;
      expect(src, rel).not.toMatch(/\bv1\.|V1Database/);
    }
  });

  it("5. Article IV: only answer generation and the providers call .reply(", () => {
    const callers = sources().filter(({ src }) => /\.reply\(/.test(src));
    expect(callers.length).toBeGreaterThan(0);
    for (const { rel } of callers) expect(rel).toMatch(/^src\/server\/(answers|ai)\//);
  });

  it("6. FR-062, SC-014: nothing calls .summarize( outside the providers", () => {
    for (const { rel, src } of sources()) {
      if (rel.startsWith("src/server/ai/")) continue;
      expect(src, rel).not.toMatch(/\.summarize\(/);
    }
  });

  it("7. Article I, SC-015: answers are ai_suggested and question edges user_authored", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    const q = (await askAndWait(t.answer.id, "More")).body;
    await call("POST", `/api/nodes/${q.answer.id}/ask?wait=1`, { content: "????" });
    await call("POST", `/api/edges/${t.edge.id}/attempts?wait=1`, { mode: "regenerate" });
    const rows = await db.selectFrom("nodes").select(["kind", "provenance"]).execute();
    expect(rows.filter((r) => r.kind === "answer").length).toBe(4);
    for (const r of rows) expect(r.provenance).toBe(r.kind === "question" ? "user_authored" : "ai_suggested");
  });

  it("8. SC-013: the runner names no function or kind", () => {
    const src = readFileSync(path.join(root, "src/server/functions/runner.ts"), "utf8");
    const ids = [...allKinds().map((k) => k.id), "analogy"];
    for (const id of ids) expect(src, id).not.toMatch(new RegExp(`["'\`]${id}["'\`]`));
  });

  it("Articles I and VI: history tables are typed and append-only", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    const span = spanOf(t.answer.text, "Containers");
    const def = (await call("POST", "/api/definitions", { nodeId: t.answer.id, ...span })).body.definition;
    await drainDrafts();
    await call("POST", `/api/definitions/${def.id}/confirm`, {});
    await call("PUT", `/api/edges/${t.edge.id}/note`, { text: "first" });
    const versions = await db.selectFrom("definition_versions").select("provenance").orderBy("created_at").execute();
    expect(versions.map((v) => v.provenance)).toEqual(["ai_suggested", "user_confirmed"]);

    const append = ["edge_notes", "output_reviews", "kind_setting_changes", "parked_tangents", "parked_tangent_events", "v1_conversion"];
    const { rows } = await sql<{ name: string }>`
      SELECT c.relname AS name FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND tg.tgname = c.relname || '_append_only'`.execute(db);
    expect(rows.map((r) => r.name)).toEqual(expect.arrayContaining(append));
    await expect(sql`UPDATE edge_notes SET text = 'changed'`.execute(db)).rejects.toThrow(/append-only/);
    for (const { rel, src } of sources()) {
      expect(src, rel).not.toMatch(
        /(updateTable|deleteFrom)\("(definition_versions|edge_notes|output_reviews|kind_setting_changes|parked_tangents|parked_tangent_events|v1_conversion|setting_changes)"\)/,
      );
    }
  });

  it("Feature 5: suggested underlines need no AI call and store nothing", async () => {
    const provider = await import("@/server/ai/fake");
    expect("suggestSpans" in new provider.FakeAIProvider()).toBe(false);
    for (const { rel, src } of sources()) {
      if (rel.startsWith("src/server/db/migrations/") || rel === "src/server/db/migrationList.ts") continue;
      expect(src, rel).not.toMatch(/span_suggestions|suggestSpans/);
    }
  });

  it("Feature 6: settings are user-authored and only the settings module reads their history", async () => {
    await call("PUT", "/api/settings", { informationPressure: 3, replyModel: "claude-sonnet-5" });
    const rows = await db.selectFrom("setting_changes").select("provenance").execute();
    expect(rows.every((r) => r.provenance === "user_authored")).toBe(true);
    for (const { rel, src } of sources()) {
      if (/setting_changes/.test(src)) expect(rel).toMatch(/^src\/server\/(settings|db)\//);
    }
    // Definitions never see the level or reply model.
    for (const file of files(path.join(root, "src/server/definitions"), /\.ts$/)) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/pressure|reply_model|replyModel/i);
    }
  });

  it("Feature 8: parked tangents are user-authored, append-only and only reach the AI once fired", async () => {
    const projectId = await newProject();
    const t = await startTree(projectId, "Pods");
    const span = spanOf(t.answer.text, "Containers");
    const a = (await call("POST", `/api/nodes/${t.answer.id}/parked`, { ...span, question: "Why?" })).body.parked;
    const b = (await call("POST", `/api/nodes/${t.answer.id}/parked`, span)).body.parked;
    await call("PUT", `/api/parked/${a.id}/question`, { question: "How?" });
    await call("POST", `/api/parked/${b.id}/discard`);
    await call("POST", `/api/parked/${a.id}/fire?wait=1`);
    const tangents = await db.selectFrom("parked_tangents").select("provenance").execute();
    const events = await db.selectFrom("parked_tangent_events").select("provenance").execute();
    expect(tangents.length).toBe(2);
    expect(events.length).toBe(4);
    expect([...tangents, ...events].every((r) => r.provenance === "user_authored")).toBe(true);
    for (const { rel, src } of sources()) {
      if (/parked_tangent/.test(src)) expect(rel).toMatch(/^src\/server\/(parked|db)\//);
      if (rel.startsWith("src/server/ai/") || rel === "src/server/graph/context.ts") expect(src, rel).not.toMatch(/parked/i);
    }
  });

  it("Feature 10: functions run only from the runner, and saving a setting never runs one", () => {
    for (const { rel, src } of sources()) {
      if (/\.complete\(/.test(src)) expect(rel).toMatch(/^src\/server\/(ai|functions)\//);
      if (rel.startsWith("src/server/settings/")) expect(src, rel).not.toMatch(/functions\/runner/);
      if (/kind_setting_changes/.test(src)) expect(rel).toMatch(/^src\/server\/(settings|db)\//);
      // Every element is created through insertElement, which takes its shape from the kind.
      if (/insertInto\("nodes"\)/.test(src)) expect(rel).toMatch(/^src\/server\/(graph\/elements\.ts|db\/)/);
    }
  });
});
