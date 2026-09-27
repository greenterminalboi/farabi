import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { getFakeCalls, setFakeMode } from "@/server/ai/fake";
import { db } from "@/server/db/client";
import { drainSummaries } from "@/server/summaries/queue";
import { call, sendAndWait } from "./helpers";

async function root() {
  const res = await call("POST", "/api/trees", {});
  return res.body.node.id as string;
}

const suggestions = (nodeId: string) => call("POST", `/api/nodes/${nodeId}/suggestions`, {});

/** Row counts for every table except the suggestions cache (SC-004). */
async function structureCounts(): Promise<Record<string, number>> {
  const { rows } = await sql<{ table_name: string }>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      AND table_name NOT IN ('span_suggestions', 'kysely_migration', 'kysely_migration_lock')`.execute(db);
  const counts: Record<string, number> = {};
  for (const { table_name } of rows) {
    const r = await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.table(table_name)}`.execute(db);
    counts[table_name] = Number(r.rows[0].n);
  }
  return counts;
}

describe("Feature 5 · suggested spans", () => {
  it("returns validated spans for a completed AI reply", async () => {
    const nodeId = await root();
    const sent = await sendAndWait(nodeId, "Pods");
    const ai = sent.body.aiMessage;
    const res = await suggestions(nodeId);
    expect(res.status).toBe(200);
    expect(res.body.pending).toEqual([]);
    const spans = res.body.byMessage[ai.id];
    expect(spans).toHaveLength(1);
    expect(spans[0].text).toBe("Containers are mentioned here.");
    expect(ai.content.slice(spans[0].start, spans[0].end)).toBe(spans[0].text);
    expect(getFakeCalls().lastSuggest).toEqual({ text: ai.content });
  });

  it("never covers user messages or replies that ended early (FR-003, FR-007)", async () => {
    const nodeId = await root();
    const ok = await sendAndWait(nodeId, "Pods");
    setFakeMode({ mode: "stall" });
    const stalled = await sendAndWait(nodeId, "interrupt me");
    expect(stalled.body.aiMessage.status).toBe("incomplete");
    setFakeMode({ mode: "ok", chunkDelayMs: 200 });
    const started = await call("POST", `/api/nodes/${nodeId}/messages`, { content: "stop me" });
    await call("POST", `/api/messages/${started.body.aiMessage.id}/stop`, {});

    const res = await suggestions(nodeId);
    const keys = Object.keys(res.body.byMessage);
    expect(keys).toEqual([ok.body.aiMessage.id]);
    for (const id of [ok.body.userMessage.id, stalled.body.userMessage.id, stalled.body.aiMessage.id, started.body.aiMessage.id]) {
      expect(keys).not.toContain(id);
      expect(res.body.pending).not.toContain(id);
    }
  });

  it("uses the cache on later calls (FR-013, SC-006)", async () => {
    const nodeId = await root();
    await sendAndWait(nodeId, "Pods");
    const first = await suggestions(nodeId);
    expect(getFakeCalls().suggestCalls).toBe(1);
    const second = await suggestions(nodeId);
    expect(second.body).toEqual(first.body);
    expect(getFakeCalls().suggestCalls).toBe(1);
  });

  it("writes nothing outside the hidden cache (SC-004, FR-006)", async () => {
    const nodeId = await root();
    await sendAndWait(nodeId, "Pods");
    await drainSummaries();
    const before = await structureCounts();
    await suggestions(nodeId);
    await drainSummaries();
    expect(await structureCounts()).toEqual(before);
    const rows = await db.selectFrom("span_suggestions").select("provenance").execute();
    expect(rows.map((r) => r.provenance)).toEqual(["ai_suggested"]);
  });

  it("shows nothing and doesn't retry during the cooldown when the AI is unavailable", async () => {
    const nodeId = await root();
    const sent = await sendAndWait(nodeId, "Pods");
    setFakeMode({ mode: "fail" });
    const res = await suggestions(nodeId);
    expect(res.body).toEqual({ byMessage: {}, pending: [] });
    expect(await db.selectFrom("span_suggestions").selectAll().execute()).toEqual([]);
    const calls = getFakeCalls().suggestCalls;
    await suggestions(nodeId);
    expect(getFakeCalls().suggestCalls).toBe(calls);
    expect(sent.body.aiMessage.status).toBe("complete");
  });

  it("caches an empty result for a reply with no candidates", async () => {
    const nodeId = await root();
    const sent = await sendAndWait(nodeId, "Pods");
    // A reply with nothing worth flagging: stored as [] so it isn't analyzed again.
    await db.updateTable("messages").set({ content: "Echo: ok." }).where("id", "=", sent.body.aiMessage.id).execute();
    const res = await suggestions(nodeId);
    expect(res.body.byMessage[sent.body.aiMessage.id]).toEqual([]);
    await suggestions(nodeId);
    expect(getFakeCalls().suggestCalls).toBe(1);
  });

  it("returns 404 for an unknown node", async () => {
    const res = await suggestions("00000000-0000-4000-8000-000000000000");
    expect(res.status).toBe(404);
  });
});
