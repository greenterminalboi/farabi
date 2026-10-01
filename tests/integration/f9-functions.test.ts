import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { drainGenerations } from "@/server/messages/generation";
import { drainSummaries } from "@/server/summaries/queue";
import { call, sendAndWait } from "./helpers";

type Msg = { id: string; content: string; role: string; status: string };

async function root() {
  return (await call("POST", "/api/trees", {})).body.node.id as string;
}

/** A root conversation with one complete AI reply and its summary. */
async function summarized() {
  const nodeId = await root();
  const ai: Msg = (await sendAndWait(nodeId, "Pods")).body.aiMessage;
  await drainSummaries();
  return { nodeId, ai };
}

const forest = async () => (await call("GET", "/api/forest")).body;

describe("Feature 9 · migration and origins", () => {
  it("records kind and origin for every way a conversation starts", async () => {
    const { nodeId, ai } = await summarized();
    const start = ai.content.indexOf("Containers");
    const anchor = { messageId: ai.id, start, end: start + 10, text: "Containers", prefix: "", suffix: "" };
    const branch = (await call("POST", `/api/nodes/${nodeId}/branches`, anchor)).body.node.id;
    const quick = (await call("POST", `/api/nodes/${nodeId}/messages`, { content: "????" })).body.node.id;
    await drainGenerations();
    const parked = (await call("POST", `/api/nodes/${nodeId}/parked`, anchor)).body.parked.id;
    const fired = (await call("POST", `/api/parked/${parked}/fire`)).body.node.id;

    const rows = await db.selectFrom("nodes").select(["id", "kind", "origin"]).execute();
    const origin = Object.fromEntries(rows.map((r) => [r.id, r.origin]));
    expect(rows.every((r) => r.kind === "conversation")).toBe(true);
    expect([origin[nodeId], origin[branch], origin[quick], origin[fired]]).toEqual(["root", "branch", "quick_branch", "parked"]);

    const nodes = (await forest()).nodes as Array<{ id: string; origin: string; kind: string; output: unknown }>;
    expect(nodes.find((n) => n.id === branch)).toMatchObject({ origin: "branch", kind: "conversation", output: null });
  });

  it("keeps summaries append-only, so their id is a version (FR-020)", async () => {
    await summarized();
    await expect(sql`UPDATE node_summaries SET text = 'x'`.execute(db)).rejects.toThrow(/append-only/);
  });
});

const count = async (table: "nodes" | "pipes" | "function_output_versions") =>
  (await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.table(table)}`.execute(db)).rows[0].n;

async function runAnalogy(nodeId: string) {
  return call("POST", `/api/nodes/${nodeId}/functions/analogy/run`);
}

describe("Feature 9 · US1 run", () => {
  it("lists Analogy as unavailable until the node has a summary (FR-010)", async () => {
    const nodeId = await root();
    const res = await call("GET", `/api/nodes/${nodeId}/functions`);
    expect(res.body.functions).toEqual([
      expect.objectContaining({ id: "analogy", available: false, reason: expect.stringMatching(/no summary yet/) }),
    ]);
    expect((await runAnalogy(nodeId)).body.error.code).toBe("function_unavailable");
  });

  it("creates an ai_suggested output and pipe in the same tree, leaving the source alone (FR-011)", async () => {
    const { nodeId } = await summarized();
    const before = (await call("GET", `/api/nodes/${nodeId}`)).body;
    const summaryId = (await db.selectFrom("node_summaries").select("id").where("node_id", "=", nodeId).executeTakeFirstOrThrow()).id;

    expect((await call("GET", `/api/nodes/${nodeId}/functions`)).body.functions[0]).toMatchObject({ available: true, reason: null });
    const res = await runAnalogy(nodeId);
    expect(res.status).toBe(201);
    const { output, pipe } = res.body;
    expect(output).toMatchObject({
      kind: "analogy",
      origin: "function",
      treeId: before.node.treeId,
      parentId: null,
      isRoot: false,
      output: { review: "proposed", provenance: "ai_suggested", stale: false, pendingDraft: false, versionCount: 1 },
    });
    expect(output.output.displayedText).toMatch(/^Fake analogy #\d+$/);
    expect(pipe).toMatchObject({ inputNodeId: nodeId, outputNodeId: output.id, reads: "summary", functionVersion: 1, state: "proposed" });

    const { getFakeCalls } = await import("@/server/ai/fake");
    const summary = before.node.summary.text as string;
    expect(getFakeCalls().lastComplete?.prompt).toContain(summary.replace(/</g, "&lt;"));
    expect(getFakeCalls().lastComplete?.system).toMatch(/everyday life[\s\S]*two or three sentences/);

    const version = await db.selectFrom("function_output_versions").selectAll().executeTakeFirstOrThrow();
    expect(version.source_version).toBe(summaryId);
    expect(version.settings).toEqual({ reach: "everyday", length: "short" });

    // The source is untouched (US1 AS5, FR-038).
    const after = (await call("GET", `/api/nodes/${nodeId}`)).body;
    expect(after.messages).toEqual(before.messages);
    expect(after.node.summary).toEqual(before.node.summary);
    expect(after.node.manual).toEqual(before.node.manual);
    expect(after.children).toEqual([]);

    const f = await forest();
    expect(f.nodes.map((n: { id: string }) => n.id)).toContain(output.id);
    expect(f.pipes).toEqual([pipe]);
    // Only functions that accept the node's kind are listed (US1 AS2).
    expect((await call("GET", `/api/nodes/${output.id}/functions`)).body.functions).toEqual([]);
    expect((await runAnalogy(output.id)).body.error.code).toBe("wrong_kind");
  });

  it("creates nothing when the AI fails (FR-012)", async () => {
    const { nodeId } = await summarized();
    const { setFakeMode } = await import("@/server/ai/fake");
    const counts = [await count("nodes"), await count("pipes"), await count("function_output_versions")];
    setFakeMode({ mode: "fail" });
    const res = await runAnalogy(nodeId);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("ai_unavailable");
    expect([await count("nodes"), await count("pipes"), await count("function_output_versions")]).toEqual(counts);
  });

  it("makes an independent output each time it runs", async () => {
    const { nodeId } = await summarized();
    const a = (await runAnalogy(nodeId)).body.output.id;
    const b = (await runAnalogy(nodeId)).body.output.id;
    expect(a).not.toBe(b);
    expect((await forest()).pipes).toHaveLength(2);
  });

  it("won't run in a trashed project, or an unknown function (FR-013)", async () => {
    const { nodeId } = await summarized();
    expect((await call("POST", `/api/nodes/${nodeId}/functions/nope/run`)).status).toBe(404);
    await db.updateTable("projects").set({ trashed_at: new Date() }).execute();
    expect((await runAnalogy(nodeId)).status).toBe(404);
  });

  it("records the summary it read, so a summary written meanwhile makes it stale", async () => {
    const { nodeId, ai } = await summarized();
    const { setFakeMode } = await import("@/server/ai/fake");
    setFakeMode({ mode: "slow", delayMs: 300 });
    const pending = runAnalogy(nodeId);
    await new Promise((r) => setTimeout(r, 50));
    await db.insertInto("node_summaries").values({ node_id: nodeId, text: "Newer.", provenance: "ai_suggested", through_message_id: ai.id }).execute();
    const res = await pending;
    expect(res.body.output.output.stale).toBe(true);
  });
});

/** A summarized conversation with one Analogy output. */
async function withAnalogy() {
  const { nodeId, ai } = await summarized();
  const { output, pipe } = (await runAnalogy(nodeId)).body;
  return { nodeId, ai, output, pipe };
}

describe("Feature 9 · US2 views", () => {
  it("shows the output beside its input, and the pipe on its own (FR-017, FR-019)", async () => {
    const { nodeId, output, pipe } = await withAnalogy();
    const source = (await call("GET", `/api/nodes/${nodeId}`)).body;

    const view = (await call("GET", `/api/nodes/${output.id}/output`)).body;
    expect(view.node.id).toBe(output.id);
    expect(view.pipe).toEqual(pipe);
    expect(view.versions).toHaveLength(1);
    expect(view.versions[0]).toMatchObject({ provenance: "ai_suggested", confirmed: false });
    expect(view.input.node.id).toBe(nodeId);
    expect(view.input.messages).toEqual(source.messages);
    expect(view.settings.map((s: { key: string; source: string }) => [s.key, s.source])).toEqual([
      ["reach", "default"],
      ["length", "default"],
    ]);

    const pv = (await call("GET", `/api/nodes/${pipe.id}/pipe`)).body;
    expect(pv).toMatchObject({ pipe, versionCount: 1, stale: false });
    expect(pv.input.id).toBe(nodeId);
    expect(pv.output.id).toBe(output.id);
  });

  it("answers wrong_kind when a view is asked of the wrong kind", async () => {
    const { nodeId, output, pipe } = await withAnalogy();
    const res = await call("GET", `/api/nodes/${output.id}`);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: "wrong_kind" }, kind: "analogy" });
    expect((await call("GET", `/api/nodes/${nodeId}/output`)).body.error.code).toBe("wrong_kind");
    expect((await call("GET", `/api/nodes/${output.id}/pipe`)).body.error.code).toBe("wrong_kind");
    expect((await call("GET", `/api/nodes/${pipe.id}`)).body.error.code).toBe("wrong_kind");
  });

  it("refuses conversation actions on an analogy (FR-005)", async () => {
    const { ai, output } = await withAnalogy();
    const anchor = { messageId: ai.id, start: 0, end: 4, text: ai.content.slice(0, 4), prefix: "", suffix: "" };
    const attempts = [
      call("POST", `/api/nodes/${output.id}/messages`, { content: "hi" }),
      call("POST", `/api/nodes/${output.id}/messages`, { content: "????" }),
      call("POST", `/api/nodes/${output.id}/branches`, anchor),
      call("POST", `/api/nodes/${output.id}/parked`, anchor),
      call("POST", `/api/nodes/${output.id}/summary/refresh`),
      call("POST", "/api/definitions", { nodeId: output.id, messageId: ai.id, start: 0, end: 4, text: ai.content.slice(0, 4) }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("wrong_kind");
    }
  });

  it("lets an output be dragged, but never a pipe, and gives outputs no edge label", async () => {
    const { output, pipe } = await withAnalogy();
    const before = await db.selectFrom("pipes").selectAll().executeTakeFirstOrThrow();
    const moved = await call("PUT", `/api/nodes/${output.id}/position`, { x: 400, y: 20 });
    expect(moved.status).toBe(200);
    expect(moved.body.node).toMatchObject({ manual: { x: 400, y: 20 }, output: { review: "proposed" } });
    expect(await db.selectFrom("pipes").selectAll().executeTakeFirstOrThrow()).toEqual(before);
    expect((await call("PUT", `/api/nodes/${pipe.id}/position`, { x: 1, y: 1 })).body.error.code).toBe("wrong_kind");
    expect((await call("PUT", `/api/nodes/${output.id}/edge-label`, { text: "x" })).body.error.code).toBe("root_node");
  });
});

const outputIn = async (id: string) => (await forest()).nodes.find((n: { id: string }) => n.id === id);
const latestVersionId = async (outputId: string) =>
  (await call("GET", `/api/nodes/${outputId}/output`)).body.versions[0].id as string;

describe("Feature 9 · US3 review", () => {
  it("confirms an output and its pipe (US3 AS1)", async () => {
    const { output } = await withAnalogy();
    const versionId = await latestVersionId(output.id);
    const res = await call("POST", `/api/nodes/${output.id}/output/confirm`, { versionId });
    expect(res.status).toBe(200);
    expect(res.body.output.output).toMatchObject({ review: "confirmed", provenance: "user_confirmed" });
    expect((await forest()).pipes[0].state).toBe("confirmed");
    const events = await db.selectFrom("function_output_events").selectAll().execute();
    expect(events).toEqual([expect.objectContaining({ kind: "confirmed", version_id: versionId, provenance: "user_confirmed" })]);

    expect((await call("POST", `/api/nodes/${output.id}/output/confirm`, { versionId })).body.error.code).toBe("already_confirmed");
  });

  it("rejects without deleting, and can bring a rejected output back (US3 AS2)", async () => {
    const { output, pipe } = await withAnalogy();
    const res = await call("POST", `/api/nodes/${output.id}/output/reject`);
    expect(res.body.output.output.review).toBe("rejected");
    expect((await outputIn(output.id)).output.review).toBe("rejected");
    expect((await forest()).pipes[0]).toMatchObject({ id: pipe.id, state: "rejected" });
    expect(await count("nodes")).toBe(3);
    expect(await count("function_output_versions")).toBe(1);
    const [event] = await db.selectFrom("function_output_events").selectAll().execute();
    expect(event).toMatchObject({ kind: "rejected", provenance: "user_authored" });
    expect((await call("POST", `/api/nodes/${output.id}/output/reject`)).body.error.code).toBe("already_rejected");

    const versionId = await latestVersionId(output.id);
    expect((await call("POST", `/api/nodes/${output.id}/output/confirm`, { versionId })).body.output.output.review).toBe("confirmed");
  });

  it("stays ai_suggested until the user acts (US3 AS3), and history can't be rewritten", async () => {
    const { output } = await withAnalogy();
    expect((await outputIn(output.id)).output).toMatchObject({ review: "proposed", provenance: "ai_suggested" });
    await call("POST", `/api/nodes/${output.id}/output/reject`);
    await expect(sql`UPDATE function_output_events SET kind = 'confirmed'`.execute(db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM function_output_versions`.execute(db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM pipes`.execute(db)).rejects.toThrow(/append-only/);
  });

  it("confirms only the newest version, of an output (not_latest, wrong_kind)", async () => {
    const { nodeId, output } = await withAnalogy();
    const first = await latestVersionId(output.id);
    await call("POST", `/api/nodes/${output.id}/output/regenerate`);
    expect((await call("POST", `/api/nodes/${output.id}/output/confirm`, { versionId: first })).body.error.code).toBe("not_latest");
    expect((await call("POST", `/api/nodes/${nodeId}/output/reject`)).body.error.code).toBe("wrong_kind");
  });
});

describe("Feature 9 · US4 staleness", () => {
  /** Another exchange in the source, so its summary is regenerated. */
  async function drift(nodeId: string) {
    await sendAndWait(nodeId, "And Deployments?");
    await drainSummaries();
  }

  it("marks an output stale when the source summary changes, with no AI call (FR-022, FR-024, SC-004)", async () => {
    const { nodeId, output } = await withAnalogy();
    expect((await outputIn(output.id)).output.stale).toBe(false);
    const { getFakeCalls } = await import("@/server/ai/fake");
    await drift(nodeId);
    const calls = getFakeCalls().completeInputs.length;
    expect((await outputIn(output.id)).output.stale).toBe(true);
    await forest();
    await forest();
    expect(getFakeCalls().completeInputs.length).toBe(calls);
    expect(await count("function_output_versions")).toBe(1);
  });

  it("regenerates on request, keeping every version (FR-025)", async () => {
    const { nodeId, output } = await withAnalogy();
    await drift(nodeId);
    const res = await call("POST", `/api/nodes/${output.id}/output/regenerate`);
    expect(res.status).toBe(201);
    const newest = await db.selectFrom("node_summaries").select("id").where("node_id", "=", nodeId).orderBy("created_at", "desc").orderBy("id", "desc").executeTakeFirstOrThrow();
    expect(res.body.version).toMatchObject({ sourceVersion: newest.id, provenance: "ai_suggested", confirmed: false });
    expect(res.body.output.output).toMatchObject({ stale: false, displayedText: res.body.version.text, versionCount: 2 });
    const view = (await call("GET", `/api/nodes/${output.id}/output`)).body;
    expect(view.versions.map((v: { id: string }) => v.id)[0]).toBe(res.body.version.id);
    expect(view.versions).toHaveLength(2);
  });

  it("keeps a confirmed text until the user confirms the new draft (FR-026, SC-005)", async () => {
    const { nodeId, output } = await withAnalogy();
    const confirmedText = output.output.displayedText;
    await call("POST", `/api/nodes/${output.id}/output/confirm`, { versionId: await latestVersionId(output.id) });
    await drift(nodeId);
    const { version } = (await call("POST", `/api/nodes/${output.id}/output/regenerate`)).body;
    expect((await outputIn(output.id)).output).toMatchObject({
      review: "confirmed",
      displayedText: confirmedText,
      pendingDraft: true,
      stale: false,
    });
    await call("POST", `/api/nodes/${output.id}/output/confirm`, { versionId: version.id });
    expect((await outputIn(output.id)).output).toMatchObject({ displayedText: version.text, pendingDraft: false });
  });

  it("adds nothing when regenerating fails", async () => {
    const { nodeId, output } = await withAnalogy();
    await drift(nodeId);
    const { setFakeMode } = await import("@/server/ai/fake");
    setFakeMode({ mode: "fail" });
    expect((await call("POST", `/api/nodes/${output.id}/output/regenerate`)).status).toBe(503);
    expect(await count("function_output_versions")).toBe(1);
    expect((await outputIn(output.id)).output.stale).toBe(true);
  });
});

describe("Feature 9 · US5 settings", () => {
  it("uses the kind value for new runs, and saving runs nothing (SC-008)", async () => {
    const { nodeId } = await summarized();
    const { getFakeCalls } = await import("@/server/ai/fake");
    const before = getFakeCalls().completeInputs.length;
    const saved = await call("PUT", "/api/kind-settings", { kind: "analogy", key: "length", value: "one_line" });
    expect(saved.status).toBe(200);
    expect(saved.body.kinds).toEqual([
      { kind: "analogy", settings: [expect.objectContaining({ key: "reach" }), expect.objectContaining({ key: "length", value: "one_line", source: "kind" })] },
    ]);
    expect(getFakeCalls().completeInputs.length).toBe(before);

    await runAnalogy(nodeId);
    expect(getFakeCalls().lastComplete?.system).toContain("Write one sentence");
    const v = await db.selectFrom("function_output_versions").select("settings").executeTakeFirstOrThrow();
    expect(v.settings.length).toBe("one_line");
  });

  it("applies a node's override only to that node's regenerations (US5 AS3)", async () => {
    const { nodeId } = await summarized();
    await call("PUT", "/api/kind-settings", { kind: "analogy", key: "length", value: "one_line" });
    const a = (await runAnalogy(nodeId)).body.output.id;
    const b = (await runAnalogy(nodeId)).body.output.id;
    const res = await call("PUT", `/api/nodes/${a}/settings`, { key: "length", value: "paragraph" });
    expect(res.body.settings.find((s: { key: string }) => s.key === "length")).toMatchObject({ value: "paragraph", source: "override" });

    const ra = (await call("POST", `/api/nodes/${a}/output/regenerate`)).body.version;
    const rb = (await call("POST", `/api/nodes/${b}/output/regenerate`)).body.version;
    expect(ra.settings.length).toBe("paragraph");
    expect(rb.settings.length).toBe("one_line");
    expect((await call("PUT", `/api/nodes/${nodeId}/settings`, { key: "length", value: "short" })).status).toBe(422);
  });
});

describe("Feature 9 · extensibility (SC-006)", () => {
  it("runs a function added by definition alone, through the unchanged runner", async () => {
    const { registerFunction, findFunction } = await import("@/server/functions/definitions");
    if (!findFunction("echo-anchor")) {
      registerFunction({
        id: "echo-anchor",
        version: 3,
        name: "Echo anchor",
        accepts: ["conversation"],
        reads: "anchor",
        outputKind: "analogy",
        procedure: "propose",
        instruction: { system: () => "Repeat the passage.", prompt: (source) => `<passage>${source.text}</passage>` },
        parse: (text) => text.trim(),
      });
    }
    const { nodeId, ai } = await summarized();
    expect((await call("GET", `/api/nodes/${nodeId}/functions`)).body.functions).toContainEqual(
      expect.objectContaining({ id: "echo-anchor", available: false, reason: expect.stringMatching(/highlighted passage/) }),
    );

    const start = ai.content.indexOf("Containers");
    const anchor = { messageId: ai.id, start, end: start + 10, text: "Containers", prefix: "", suffix: "" };
    const branch = (await call("POST", `/api/nodes/${nodeId}/branches`, anchor)).body.node.id;
    const res = await call("POST", `/api/nodes/${branch}/functions/echo-anchor/run`);
    expect(res.status).toBe(201);
    expect(res.body.pipe).toMatchObject({ functionId: "echo-anchor", functionVersion: 3, reads: "anchor", functionName: "Echo anchor" });
    const { getFakeCalls } = await import("@/server/ai/fake");
    expect(getFakeCalls().lastComplete).toMatchObject({ tag: "echo-anchor", prompt: "<passage>Containers</passage>" });
  });
});
