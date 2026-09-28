import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { getFakeCalls, setFakeMode } from "@/server/ai/fake";
import { db } from "@/server/db/client";
import { drainGenerations } from "@/server/messages/generation";
import { drainSummaries } from "@/server/summaries/queue";
import { REPLY_MODELS } from "@/shared/models";
import { call, sendAndWait } from "./helpers";

async function root() {
  const res = await call("POST", "/api/trees", {});
  return res.body.node.id as string;
}

const save = (patch: Record<string, unknown>) => call("PUT", "/api/settings", patch);
const aiRow = (id: string) => db.selectFrom("messages").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

function anchorFor(message: { id: string; content: string }, phrase: string) {
  const start = message.content.indexOf(phrase);
  const end = start + phrase.length;
  return {
    messageId: message.id,
    start,
    end,
    text: phrase,
    prefix: message.content.slice(Math.max(0, start - 32), start),
    suffix: message.content.slice(end, end + 32),
  };
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
    const nodeId = await root();
    await save({ informationPressure: 2 });
    await sendAndWait(nodeId, "short please");
    expect(getFakeCalls().lastReply?.pressureLevel).toBe(2);
    await save({ informationPressure: 10 });
    const res = await sendAndWait(nodeId, "long please");
    expect(getFakeCalls().lastReply?.pressureLevel).toBe(10);
    expect(res.body.aiMessage.pressureLevel).toBe(10);
  });
});

describe("Feature 6 · US2 applies everywhere", () => {
  it("roots, branches, quick branches, retries and regenerates all use the current level", async () => {
    await save({ informationPressure: 3 });
    const nodeId = await root();
    const first = await sendAndWait(nodeId, "Pods");

    const branch = await call("POST", `/api/nodes/${nodeId}/branches`, anchorFor(first.body.aiMessage, "Containers"));
    const inBranch = await sendAndWait(branch.body.node.id, "Tell me more");

    const quick = await call("POST", `/api/nodes/${nodeId}/messages`, { content: "????" });
    expect(quick.body.kind).toBe("quick_branch");
    await drainGenerations();
    const quickView = await call("GET", `/api/nodes/${quick.body.node.id}`);

    setFakeMode({ mode: "fail" });
    const failed = await sendAndWait(nodeId, "this one fails");
    setFakeMode({ mode: "ok" });
    const retried = await call("POST", `/api/messages/${failed.body.aiMessage.id}/retry?wait=1`, {});
    const regen = await call("POST", `/api/messages/${retried.body.aiMessage.id}/regenerate?wait=1`, {});

    const ids = [
      first.body.aiMessage.id,
      inBranch.body.aiMessage.id,
      quickView.body.messages[1].id,
      failed.body.aiMessage.id,
      retried.body.aiMessage.id,
      regen.body.aiMessage.id,
    ];
    for (const id of ids) expect((await aiRow(id)).pressure_level, id).toBe(3);
    expect(getFakeCalls().replyInputs.every((i) => i.pressureLevel === 3)).toBe(true);
  });

  it("a conversation opened before a change uses the new level for its next reply (US2 AS3)", async () => {
    const nodeId = await root();
    await save({ informationPressure: 3 });
    const a = await sendAndWait(nodeId, "one");
    await save({ informationPressure: 6 });
    const b = await sendAndWait(nodeId, "two");
    expect([a.body.aiMessage.pressureLevel, b.body.aiMessage.pressureLevel]).toEqual([3, 6]);
  });
});

describe("Feature 6 · US3 each reply keeps its own level", () => {
  it("a later change never rewrites an earlier reply (FR-010)", async () => {
    const nodeId = await root();
    await save({ informationPressure: 4 });
    const first = await sendAndWait(nodeId, "first");
    await save({ informationPressure: 9 });
    await sendAndWait(nodeId, "second");
    const view = await call("GET", `/api/nodes/${nodeId}`);
    const ai = view.body.messages.filter((m: { role: string }) => m.role === "ai");
    expect(ai.map((m: { pressureLevel: number }) => m.pressureLevel)).toEqual([4, 9]);
    expect(ai[0].id).toBe(first.body.aiMessage.id);
  });

  it("a reply keeps the level it started with when the setting changes mid-stream", async () => {
    const nodeId = await root();
    await save({ informationPressure: 5 });
    setFakeMode({ mode: "ok", chunkDelayMs: 150 });
    const res = await call("POST", `/api/nodes/${nodeId}/messages`, { content: "slow" });
    await save({ informationPressure: 9 });
    await drainGenerations();
    expect((await aiRow(res.body.aiMessage.id)).pressure_level).toBe(5);
    expect(getFakeCalls().replyInputs.at(-1)?.pressureLevel).toBe(5);
  });

  it("stopped and failed replies record a level; user messages and older replies have none", async () => {
    const nodeId = await root();
    await save({ informationPressure: 7 });
    setFakeMode({ mode: "ok", chunkDelayMs: 200 });
    const started = await call("POST", `/api/nodes/${nodeId}/messages`, { content: "stop me" });
    const stopped = await call("POST", `/api/messages/${started.body.aiMessage.id}/stop`, {});
    expect(stopped.body.message.pressureLevel).toBe(7);
    setFakeMode({ mode: "fail" });
    const failed = await sendAndWait(nodeId, "fail me");
    expect(failed.body.aiMessage.status).toBe("failed");
    expect(failed.body.aiMessage.pressureLevel).toBe(7);
    expect(failed.body.userMessage.pressureLevel).toBeNull();

    // A reply stored before this feature existed.
    const old = await db
      .insertInto("messages")
      .values({ node_id: nodeId, seq: 100, role: "ai", content: "old", status: "complete", provenance: "ai_suggested" })
      .returningAll()
      .executeTakeFirstOrThrow();
    const view = await call("GET", `/api/nodes/${nodeId}`);
    const shown = view.body.messages.find((m: { id: string }) => m.id === old.id);
    expect([shown.pressureLevel, shown.replyModel]).toEqual([null, null]);
  });
});

describe("Feature 6 · US4 reply model", () => {
  it("replies are requested from and labelled with the chosen model (SC-007)", async () => {
    const nodeId = await root();
    await save({ replyModel: "claude-sonnet-5" });
    const res = await sendAndWait(nodeId, "hi");
    expect(getFakeCalls().lastReply?.model).toBe("claude-sonnet-5");
    expect(res.body.aiMessage.replyModel).toBe("claude-sonnet-5");

    await save({ replyModel: "default" });
    const back = await sendAndWait(nodeId, "again");
    expect(getFakeCalls().lastReply?.model).toBeNull();
    expect(back.body.aiMessage.replyModel).toBeNull();
    expect((await aiRow(res.body.aiMessage.id)).reply_model).toBe("claude-sonnet-5");
  });

  it("a stored model that is no longer offered reads as Default", async () => {
    await sql`INSERT INTO setting_changes (key, value) VALUES ('reply_model', '"claude-gone"')`.execute(db);
    expect((await call("GET", "/api/settings")).body.replyModel).toBe("default");
  });

  it("summaries don't get the reply model or level (FR-018, FR-007)", async () => {
    await save({ replyModel: "claude-sonnet-5", informationPressure: 1 });
    const nodeId = await root();
    await sendAndWait(nodeId, "Pods");
    await drainSummaries();
    const summary = getFakeCalls().lastSummary;
    expect(summary).toBeDefined();
    expect(Object.keys(summary!)).not.toContain("model");
    expect(Object.keys(summary!)).not.toContain("pressureLevel");
  });
});
