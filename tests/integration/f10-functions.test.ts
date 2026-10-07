import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getFakeCalls, setFakeMode } from "@/server/ai/fake";
import { db } from "@/server/db/client";
import { askAndWait, call, newProject, startTree } from "./helpers";

// Functions on edges (story 8; FR-043–FR-054; contracts/declarations.md).

const count = async () => (await sql<{ n: number }>`SELECT count(*)::int AS n FROM nodes`.execute(db)).rows[0].n;

async function answered() {
  const projectId = await newProject();
  const t = await startTree(projectId, "Pods");
  return { projectId, ...t };
}

const run = (id: string, fn = "analogy") => call("POST", `/api/nodes/${id}/functions/${fn}/run`);

describe("Feature 10 · running a function (story 8)", () => {
  it("lists only functions that accept the element's kind", async () => {
    const { edge, answer } = await answered();
    const list = await call("GET", `/api/nodes/${answer.id}/functions`);
    expect(list.body.functions).toContainEqual({ id: "analogy", name: "Analogy", version: 2, outputKind: "analogy" });
    expect((await call("GET", `/api/nodes/${edge.id}/functions`)).body.functions).toEqual([]);
  });

  it("creates a function edge from the answer and an ai_suggested output under it, from the answer's text", async () => {
    const { answer, tree } = await answered();
    const res = await run(answer.id);
    expect(res.status).toBe(201);
    expect(res.body.edge).toMatchObject({
      kind: "function",
      shape: "edge",
      origin: "run",
      parentId: answer.id,
      treeId: tree.id,
      provenance: "ai_suggested",
      text: null,
      functionId: "analogy",
      functionName: "Analogy",
      functionVersion: 2,
      review: "proposed",
    });
    expect(res.body.output).toMatchObject({
      kind: "analogy",
      shape: "node",
      origin: "run",
      parentId: res.body.edge.id,
      provenance: "ai_suggested",
      text: expect.stringMatching(/^Fake analogy #\d+$/),
      review: "proposed",
    });
    expect(getFakeCalls().lastComplete?.prompt).toContain(`<text>\n${answer.text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}\n</text>`);
    // The answer itself is untouched.
    expect((await db.selectFrom("nodes").select("text").where("id", "=", answer.id).executeTakeFirstOrThrow()).text).toBe(answer.text);
  });

  it("writes nothing when the AI fails (FR-052)", async () => {
    const { answer } = await answered();
    const before = await count();
    setFakeMode({ mode: "fail" });
    const res = await run(answer.id);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("function_unavailable");
    expect(await count()).toBe(before);
  });

  it("refuses the wrong kind, unfinished text, a trashed project and unknown functions", async () => {
    const { projectId, edge, answer } = await answered();
    const wrong = await run(edge.id);
    expect(wrong.status).toBe(409);
    expect(wrong.body).toMatchObject({ error: { code: "wrong_kind" }, kind: "question" });
    setFakeMode({ mode: "stall" });
    const cut = (await askAndWait(answer.id, "cut")).body.answer;
    setFakeMode({ mode: "ok" });
    expect((await run(cut.id)).body.error.code).toBe("not_runnable");
    expect((await run(answer.id, "nope")).status).toBe(404);
    await call("POST", `/api/projects/${projectId}/trash`);
    expect((await run(answer.id)).status).toBe(404);
  });

  it("runs again under the same edge as a sibling output (FR-051)", async () => {
    const { answer } = await answered();
    const first = (await run(answer.id)).body;
    const again = await call("POST", `/api/edges/${first.edge.id}/rerun`);
    expect(again.status).toBe(201);
    expect(again.body.output).toMatchObject({ parentId: first.edge.id, text: expect.stringMatching(/^Fake analogy #\d+$/), review: "proposed" });
    expect((await call("POST", `/api/edges/${answer.id}/rerun`)).body.error.code).toBe("wrong_kind");
    // A second menu run is a second edge.
    const second = (await run(answer.id)).body;
    expect(second.edge.id).not.toBe(first.edge.id);
  });

  it("outputs are leaves: no ask, no branch, no function (Article I)", async () => {
    const { answer } = await answered();
    const { output } = (await run(answer.id)).body;
    expect((await call("POST", `/api/nodes/${output.id}/ask`, { content: "x" })).body.error.code).toBe("not_askable");
    expect((await call("POST", `/api/nodes/${output.id}/branches`, { start: 0, end: 4, text: "Fake" })).body.error.code).toBe(
      "not_branchable",
    );
    expect((await call("GET", `/api/nodes/${output.id}/functions`)).body.functions).toEqual([]);
  });
});

describe("Feature 10 · reviews (FR-050)", () => {
  it("confirms and rejects by appending reviews; the edge follows its outputs", async () => {
    const { projectId, answer } = await answered();
    const { edge, output } = (await run(answer.id)).body;
    const second = (await call("POST", `/api/edges/${edge.id}/rerun`)).body.output;
    const confirmed = await call("POST", `/api/nodes/${output.id}/confirm`);
    expect(confirmed.body.output).toMatchObject({ review: "confirmed", provenance: "ai_suggested" });
    expect((await call("POST", `/api/nodes/${output.id}/confirm`)).body.error.code).toBe("already_confirmed");
    await call("POST", `/api/nodes/${second.id}/reject`);

    const canvasEdge = async () =>
      (await call("GET", `/api/canvas?projectId=${projectId}`)).body.elements.find((e: { id: string }) => e.id === edge.id);
    expect((await canvasEdge()).review).toBe("confirmed");
    await call("POST", `/api/nodes/${output.id}/reject`);
    expect((await canvasEdge()).review).toBe("rejected");
    // Bringing one back.
    await call("POST", `/api/nodes/${second.id}/confirm`);
    expect((await canvasEdge()).review).toBe("confirmed");

    const reviews = await db.selectFrom("output_reviews").select(["kind", "provenance"]).orderBy("created_at").execute();
    expect(reviews.map((r) => [r.kind, r.provenance])).toEqual([
      ["confirmed", "user_confirmed"],
      ["rejected", "user_authored"],
      ["rejected", "user_authored"],
      ["confirmed", "user_confirmed"],
    ]);
    // The output row itself never changes.
    expect((await db.selectFrom("nodes").select("provenance").where("id", "=", output.id).executeTakeFirstOrThrow()).provenance).toBe(
      "ai_suggested",
    );
    await expect(sql`DELETE FROM output_reviews`.execute(db)).rejects.toThrow(/append-only/);
  });

  it("reviews only outputs", async () => {
    const { answer } = await answered();
    const { edge } = (await run(answer.id)).body;
    for (const id of [answer.id, edge.id]) {
      const res = await call("POST", `/api/nodes/${id}/confirm`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("wrong_kind");
    }
  });
});

describe("Feature 10 · function settings (FR-053)", () => {
  it("uses the kind value for a menu run, and saving runs nothing", async () => {
    const { answer } = await answered();
    const before = getFakeCalls().completeInputs.length;
    const saved = await call("PUT", "/api/kind-settings", { kind: "analogy", key: "length", value: "one_line" });
    expect(saved.status).toBe(200);
    expect(saved.body.setting).toMatchObject({ key: "length", value: "one_line", source: "kind" });
    expect(getFakeCalls().completeInputs.length).toBe(before);
    const list = await call("GET", "/api/kind-settings");
    // Feature 12's drill kind also declares settings; this checks analogy's.
    expect(list.body.kinds.filter((k: { kind: string }) => k.kind === "analogy")).toEqual([
      {
        kind: "analogy",
        label: "Analogy",
        settings: [expect.objectContaining({ key: "reach" }), expect.objectContaining({ key: "length", value: "one_line" })],
      },
    ]);
    await run(answer.id);
    expect(getFakeCalls().lastComplete?.system).toContain("Write one sentence");
  });

  it("applies an edge's override only to that edge's runs", async () => {
    const { answer } = await answered();
    await call("PUT", "/api/kind-settings", { kind: "analogy", key: "length", value: "one_line" });
    const a = (await run(answer.id)).body.edge.id;
    const b = (await run(answer.id)).body.edge.id;
    const before = getFakeCalls().completeInputs.length;
    const res = await call("PUT", `/api/edges/${a}/settings`, { key: "length", value: "paragraph" });
    expect(res.body.setting).toMatchObject({ key: "length", value: "paragraph", source: "override", kindValue: "one_line" });
    expect(getFakeCalls().completeInputs.length).toBe(before);

    await call("POST", `/api/edges/${a}/rerun`);
    expect(getFakeCalls().lastComplete?.system).toContain("120 words");
    await call("POST", `/api/edges/${b}/rerun`);
    expect(getFakeCalls().lastComplete?.system).toContain("Write one sentence");
    // A fresh menu run ignores the override.
    await run(answer.id);
    expect(getFakeCalls().lastComplete?.system).toContain("Write one sentence");

    const cleared = await call("PUT", `/api/edges/${a}/settings`, { key: "length", value: null });
    expect(cleared.body.setting).toMatchObject({ value: "one_line", source: "kind" });
    expect((await call("PUT", `/api/edges/${answer.id}/settings`, { key: "length", value: "short" })).body.error.code).toBe(
      "wrong_kind",
    );
    expect((await call("PUT", `/api/edges/${a}/settings`, { key: "reach", value: "moon" })).status).toBe(422);
    expect((await call("PUT", `/api/edges/${a}/settings`, { key: "colour", value: "red" })).status).toBe(422);
  });

  it("records each change once, with its time", async () => {
    const { answer } = await answered();
    const a = (await run(answer.id)).body.edge.id;
    await call("PUT", "/api/kind-settings", { kind: "analogy", key: "reach", value: "far" });
    await call("PUT", "/api/kind-settings", { kind: "analogy", key: "reach", value: "far" });
    await call("PUT", `/api/edges/${a}/settings`, { key: "reach", value: "close" });
    await call("PUT", `/api/edges/${a}/settings`, { key: "reach", value: "close" });
    const rows = await db.selectFrom("kind_setting_changes").selectAll().orderBy("created_at").execute();
    expect(rows.map((r) => [r.node_id, r.value])).toEqual([
      [null, "far"],
      [a, "close"],
    ]);
    expect(rows.every((r) => r.provenance === "user_authored" && r.created_at instanceof Date)).toBe(true);
    expect((await call("PUT", "/api/kind-settings", { kind: "nope", key: "reach", value: "far" })).status).toBe(422);
  });
});

describe("Feature 10 · extensibility (SC-013)", () => {
  it("runs a kind and function added by declaration alone, through the unchanged runner", async () => {
    const { registerKind, findKind } = await import("@/shared/kinds");
    const { registerFunction, findFunction } = await import("@/server/functions/definitions");
    if (!findKind("summary_card")) {
      registerKind({
        id: "summary_card",
        label: "Summary card",
        shape: "node",
        display: "output",
        acceptsInputKinds: ["answer"],
        settings: [],
        properties: z.object({}).strict(),
      });
    }
    if (!findFunction("restate")) {
      registerFunction({
        id: "restate",
        version: 1,
        name: "Restate",
        accepts: ["answer"],
        reads: "text",
        outputKind: "summary_card",
        edgeKind: "function",
        procedure: "propose",
        instruction: { system: () => "Restate the text.", prompt: (source) => `<text>${source.text}</text>` },
        parse: (text) => text.trim(),
      });
    }
    const { answer } = await answered();
    expect((await call("GET", `/api/nodes/${answer.id}/functions`)).body.functions.map((f: { id: string }) => f.id)).toContain(
      "restate",
    );
    const res = await run(answer.id, "restate");
    expect(res.status).toBe(201);
    expect(res.body.edge).toMatchObject({ kind: "function", functionId: "restate", functionName: "Restate", functionVersion: 1 });
    expect(res.body.output).toMatchObject({ kind: "summary_card", shape: "node", parentId: res.body.edge.id, text: expect.stringMatching(/^Fake restate #\d+$/) });
    expect(getFakeCalls().lastComplete).toMatchObject({ tag: "restate", prompt: `<text>${answer.text}</text>` });
  });
});
