import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { getFakeCalls, setFakeMode } from "@/server/ai/fake";
import { drainGenerations } from "@/server/answers/generation";
import { db } from "@/server/db/client";
import { REPLY_MODELS } from "@/shared/models";
import { askAndWait, call, newProject, startTree } from "./helpers";

// Feature 6 reply settings, recorded on every answer (Feature 10, FR-057, T092).

async function root(first = "Pods") {
  return startTree(await newProject(), first);
}

const save = (patch: Record<string, unknown>) => call("PUT", "/api/settings", patch);
const row = (id: string) => db.selectFrom("nodes").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

function spanOf(text: string, phrase: string) {
  const start = text.indexOf(phrase);
  return { start, end: start + phrase.length, text: phrase };
}

describe("Feature 6 · US1 settings", () => {
  it("starts at level 8 and the configured model (SC-004)", async () => {
    const res = await call("GET", "/api/settings");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      informationPressure: 8,
      replyModel: "default",
      models: REPLY_MODELS.map((m) => ({ id: m.id, label: m.label })),
    });
  });

  it("keeps every change as a new user-authored row; unchanged values write nothing (FR-013)", async () => {
    expect((await save({ informationPressure: 2 })).body.informationPressure).toBe(2);
    await save({ informationPressure: 2 });
    await save({ informationPressure: 5, replyModel: "claude-sonnet-5" });
    const rows = await db.selectFrom("setting_changes").select(["key", "value", "provenance"]).orderBy("created_at").execute();
    expect(rows.map((r) => [r.key, r.value])).toEqual([
      ["information_pressure", 2],
      ["information_pressure", 5],
      ["reply_model", "claude-sonnet-5"],
    ]);
    expect(rows.every((r) => r.provenance === "user_authored")).toBe(true);
    expect((await call("GET", "/api/settings")).body).toMatchObject({ informationPressure: 5, replyModel: "claude-sonnet-5" });
  });

  it("rejects anything but a whole level from 1 to 10 or a listed model", async () => {
    for (const body of [{}, { informationPressure: 11 }, { informationPressure: 0 }, { informationPressure: 2.5 }, { replyModel: "gpt" }]) {
      expect((await save(body)).status, JSON.stringify(body)).toBe(422);
    }
    expect(await db.selectFrom("setting_changes").selectAll().execute()).toEqual([]);
  });

  it("the database refuses to rewrite or delete settings history (Article VI)", async () => {
    await save({ informationPressure: 4 });
    await expect(sql`UPDATE setting_changes SET value = '9'`.execute(db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM setting_changes`.execute(db)).rejects.toThrow(/append-only/);
  });

  it("a change applies to the very next reply, with no restart (SC-001)", async () => {
    const t = await root();
    await save({ informationPressure: 2 });
    await askAndWait(t.answer.id, "short please");
    expect(getFakeCalls().lastReply?.pressureLevel).toBe(2);
    await save({ informationPressure: 10 });
    const res = await askAndWait(t.answer.id, "long please");
    expect(getFakeCalls().lastReply?.pressureLevel).toBe(10);
    expect(res.body.answer.pressureLevel).toBe(10);
  });
});

describe("Feature 6 · US2 applies everywhere", () => {
  it("origins, asks, branches, quick branches, retries and regenerates all use the current level", async () => {
    await save({ informationPressure: 3 });
    const t = await root("Pods");
    const q = (await askAndWait(t.answer.id, "More")).body;
    const branch = await call("POST", `/api/nodes/${t.answer.id}/branches`, spanOf(t.answer.text, "Containers"));
    const inBranch = await call("POST", `/api/edges/${branch.body.edge.id}/send?wait=1`, { content: "Tell me more" });
    const quick = await call("POST", `/api/nodes/${q.answer.id}/ask?wait=1`, { content: "????" });
    expect(quick.body.kind).toBe("quick_branch");

    setFakeMode({ mode: "fail" });
    const failed = (await askAndWait(t.answer.id, "this one fails")).body;
    setFakeMode({ mode: "ok" });
    const retried = await call("POST", `/api/edges/${failed.edge.id}/attempts?wait=1`, { mode: "retry" });
    const regen = await call("POST", `/api/edges/${failed.edge.id}/attempts?wait=1`, { mode: "regenerate" });

    const ids = [t.answer, q.answer, inBranch.body.answer, quick.body.answer, failed.answer, retried.body.answer, regen.body.answer].map(
      (a) => a.id,
    );
    for (const id of ids) expect((await row(id)).pressure_level, id).toBe(3);
    expect(getFakeCalls().replyInputs.every((i) => i.pressureLevel === 3)).toBe(true);
  });

  it("a tree started before a change uses the new level for its next reply (US2 AS3)", async () => {
    await save({ informationPressure: 3 });
    const t = await root();
    await save({ informationPressure: 6 });
    const b = (await askAndWait(t.answer.id, "two")).body;
    expect([t.answer.pressureLevel, b.answer.pressureLevel]).toEqual([3, 6]);
  });
});

describe("Feature 6 · US3 each reply keeps its own level", () => {
  it("a later change never rewrites an earlier answer (FR-010)", async () => {
    await save({ informationPressure: 4 });
    const t = await root();
    await save({ informationPressure: 9 });
    const second = (await askAndWait(t.answer.id, "second")).body;
    expect([(await row(t.answer.id)).pressure_level, (await row(second.answer.id)).pressure_level]).toEqual([4, 9]);
  });

  it("an answer keeps the level it started with when the setting changes mid-stream", async () => {
    await save({ informationPressure: 5 });
    setFakeMode({ mode: "ok", chunkDelayMs: 150 });
    const res = await call("POST", "/api/trees", { projectId: await newProject(), content: "slow" });
    await save({ informationPressure: 9 });
    await drainGenerations();
    expect((await row(res.body.answer.id)).pressure_level).toBe(5);
    expect(getFakeCalls().replyInputs.at(-1)?.pressureLevel).toBe(5);
  });

  it("stopped and failed answers record a level; question edges have none", async () => {
    await save({ informationPressure: 7 });
    setFakeMode({ mode: "ok", chunkDelayMs: 200 });
    const started = await call("POST", "/api/trees", { projectId: await newProject(), content: "stop me" });
    const stopped = await call("POST", `/api/answers/${started.body.answer.id}/stop`, {});
    expect(stopped.body.answer.pressureLevel).toBe(7);
    setFakeMode({ mode: "fail" });
    const failed = await root("fail me");
    expect(failed.answer.status).toBe("failed");
    expect(failed.answer.pressureLevel).toBe(7);
    expect((await row(failed.edge.id)).pressure_level).toBeNull();
    expect(failed.edge.pressureLevel).toBeUndefined();
  });
});

describe("Feature 6 · US4 reply model", () => {
  it("replies are requested from and labelled with the chosen model (SC-007)", async () => {
    const t = await root();
    await save({ replyModel: "claude-sonnet-5" });
    const res = (await askAndWait(t.answer.id, "hi")).body;
    expect(getFakeCalls().lastReply?.model).toBe("claude-sonnet-5");
    expect(res.answer.replyModel).toBe("claude-sonnet-5");

    await save({ replyModel: "default" });
    const back = (await askAndWait(t.answer.id, "again")).body;
    expect(getFakeCalls().lastReply?.model).toBeNull();
    expect(back.answer.replyModel).toBeNull();
    expect((await row(res.answer.id)).reply_model).toBe("claude-sonnet-5");
  });

  it("a stored model that is no longer offered reads as Default", async () => {
    await sql`INSERT INTO setting_changes (key, value) VALUES ('reply_model', '"claude-gone"')`.execute(db);
    expect((await call("GET", "/api/settings")).body.replyModel).toBe("default");
  });

  it("definition drafts don't get the reply model or level (FR-018, FR-007)", async () => {
    await save({ replyModel: "claude-sonnet-5", informationPressure: 1 });
    const t = await root();
    await call("POST", "/api/definitions", { nodeId: t.answer.id, ...spanOf(t.answer.text, "Containers") });
    const { drainDrafts } = await import("@/server/definitions/draftQueue");
    await drainDrafts();
    const define = getFakeCalls().lastDefine;
    expect(define).toBeDefined();
    expect(Object.keys(define!)).not.toContain("model");
    expect(Object.keys(define!)).not.toContain("pressureLevel");
  });
});
