import { describe, expect, it } from "vitest";
import { getFakeCalls, setFakeMode } from "@/server/ai/fake";
import { db } from "@/server/db/client";
import { drainSummaries } from "@/server/summaries/queue";
import { call } from "./helpers";

describe("US5 summaries", () => {
  it("shows a placeholder until the first completed reply", async () => {
    const t = await call("POST", "/api/trees", {});
    const view = await call("GET", `/api/nodes/${t.body.node.id}`);
    expect(view.body.node.summary).toEqual({ kind: "placeholder", text: "New conversation" });
  });

  it("writes an ai_suggested summary through the latest message after each reply", async () => {
    const t = await call("POST", "/api/trees", {});
    const msg = await call("POST", `/api/nodes/${t.body.node.id}/messages`, { content: "leader election" });
    await drainSummaries();
    const rows = await db.selectFrom("node_summaries").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provenance: "ai_suggested", through_message_id: msg.body.aiMessage.id });

    await call("POST", `/api/nodes/${t.body.node.id}/messages`, { content: "Raft versus Paxos in general" });
    await drainSummaries();
    const view = await call("GET", `/api/nodes/${t.body.node.id}`);
    expect(view.body.node.summary.kind).toBe("summary");
    expect(view.body.node.summary.text).toContain("mentioned here");
    expect(await db.selectFrom("node_summaries").selectAll().execute()).toHaveLength(2);
  });

  it("summarizes a branch from its own messages and anchor only", async () => {
    const t = await call("POST", "/api/trees", {});
    const msg = await call("POST", `/api/nodes/${t.body.node.id}/messages`, { content: "parent only text" });
    const ai = msg.body.aiMessage;
    const start = ai.content.indexOf("Containers");
    const branch = await call("POST", `/api/nodes/${t.body.node.id}/branches`, {
      messageId: ai.id, start, end: start + 10, text: "Containers", prefix: "", suffix: "",
    });
    await drainSummaries();
    await call("POST", `/api/nodes/${branch.body.node.id}/messages`, { content: "branch talk" });
    await drainSummaries();
    const input = getFakeCalls().lastSummary!;
    expect(input.anchorText).toBe("Containers");
    const contents = input.messages.map((m) => m.content);
    expect(contents[0]).toBe("branch talk");
    expect(contents.join(" ")).not.toContain("parent only text");
  });

  it("keeps the previous summary when summarizing fails", async () => {
    const t = await call("POST", "/api/trees", {});
    await call("POST", `/api/nodes/${t.body.node.id}/messages`, { content: "first" });
    await drainSummaries();
    const before = (await call("GET", `/api/nodes/${t.body.node.id}`)).body.node.summary;

    // Reply succeeds, then the summarizer fails.
    await call("POST", `/api/nodes/${t.body.node.id}/messages`, { content: "second" });
    setFakeMode({ mode: "fail" });
    const refresh = await call("POST", `/api/nodes/${t.body.node.id}/summary/refresh`, {});
    expect(refresh.status).toBe(202);
    await drainSummaries();
    setFakeMode({ mode: "ok" });
    const rows = await db.selectFrom("node_summaries").selectAll().execute();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect((await call("GET", `/api/nodes/${t.body.node.id}`)).body.node.summary.kind).toBe(before.kind);
  });

  it("returns 202 immediately even when the summarizer is slow", async () => {
    const t = await call("POST", "/api/trees", {});
    await call("POST", `/api/nodes/${t.body.node.id}/messages`, { content: "x" });
    await drainSummaries();
    setFakeMode({ mode: "slow", delayMs: 1500 });
    const started = Date.now();
    const res = await call("POST", `/api/nodes/${t.body.node.id}/summary/refresh`, {});
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ queued: true });
    expect(Date.now() - started).toBeLessThan(500);
    await drainSummaries();
  });
});

describe("SUMMARY_TRIGGER=map", () => {
  it("skips summaries after replies and refreshes stale labels when the map opens", async () => {
    process.env.SUMMARY_TRIGGER = "map";
    try {
      const t = await call("POST", "/api/trees", {});
      const other = await call("POST", "/api/trees", {});
      await call("POST", `/api/nodes/${t.body.node.id}/messages`, { content: "leader election" });
      await drainSummaries();
      expect(await db.selectFrom("node_summaries").selectAll().execute()).toHaveLength(0);

      const res = await call("POST", "/api/summaries/refresh-stale", {});
      expect(res.status).toBe(202);
      expect(res.body.queued).toBe(1); // the empty conversation has nothing to summarize
      await drainSummaries();
      const rows = await db.selectFrom("node_summaries").selectAll().execute();
      expect(rows.map((r) => r.node_id)).toEqual([t.body.node.id]);
      expect(rows.map((r) => r.node_id)).not.toContain(other.body.node.id);

      // Up to date now: nothing more to do.
      expect((await call("POST", "/api/summaries/refresh-stale", {})).body.queued).toBe(0);
    } finally {
      process.env.SUMMARY_TRIGGER = "reply";
    }
  });
});
