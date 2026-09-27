import { describe, expect, it } from "vitest";
import { getFakeCalls, setFakeMode } from "@/server/ai/fake";
import { db } from "@/server/db/client";
import { drainDrafts } from "@/server/definitions/draftQueue";
import { call, sendAndWait } from "./helpers";

async function conversationWith(text = "Tell me about Pods") {
  const t = await call("POST", "/api/trees", {});
  const nodeId = t.body.node.id as string;
  const ai = (await sendAndWait(nodeId, text)).body.aiMessage;
  return { nodeId, ai };
}

function select(ai: { id: string; content: string }, phrase: string, nodeId: string) {
  const start = ai.content.indexOf(phrase);
  return { nodeId, messageId: ai.id, start, end: start + phrase.length, text: phrase };
}

describe("Feature 2 · US4 definitions", () => {
  it("captures a term and drafts a two-part ai_suggested definition", async () => {
    const { nodeId, ai } = await conversationWith();
    const res = await call("POST", "/api/definitions", select(ai, "Containers", nodeId));
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    expect(res.body.definition).toMatchObject({ term: "Containers", termKey: "containers", source: { nodeId, messageId: ai.id } });
    await drainDrafts();
    const got = await call("GET", `/api/definitions/${res.body.definition.id}`);
    expect(got.body.definition.status).toBe("draft");
    expect(got.body.definition.current).toMatchObject({
      generalText: "General meaning of Containers.",
      usageText: "Here, Containers refers to what the conversation discussed.",
      provenance: "ai_suggested",
    });
  });

  it("drafts from the source node's own messages only", async () => {
    const { nodeId, ai } = await conversationWith("parent only text");
    const start = ai.content.indexOf("Containers");
    const branch = await call("POST", `/api/nodes/${nodeId}/branches`, {
      messageId: ai.id, start, end: start + 10, text: "Containers", prefix: "", suffix: "",
    });
    const childAi = (await sendAndWait(branch.body.node.id, "branch talk")).body.aiMessage;
    await call("POST", "/api/definitions", select(childAi, "mentioned", branch.body.node.id));
    await drainDrafts();
    const input = getFakeCalls().lastDefine!;
    expect(input.term).toBe("mentioned");
    expect(input.messages.map((m) => m.content).join(" ")).not.toContain("parent only text");
  });

  it("never duplicates a term, whatever its case, spacing or conversation", async () => {
    const a = await conversationWith();
    const first = await call("POST", "/api/definitions", select(a.ai, "Containers", a.nodeId));
    const b = await conversationWith("containers everywhere");
    const again = await call("POST", "/api/definitions", select(b.ai, "Containers", b.nodeId));
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.definition.id).toBe(first.body.definition.id);
    expect(again.body.definition.source.nodeId).toBe(a.nodeId); // first capture wins
    expect(await db.selectFrom("definitions").selectAll().execute()).toHaveLength(1);
  });

  it("confirms a draft and saves edits as user_confirmed versions, keeping history", async () => {
    const { nodeId, ai } = await conversationWith();
    const id = (await call("POST", "/api/definitions", select(ai, "Containers", nodeId))).body.definition.id;
    await drainDrafts();
    const confirmed = await call("POST", `/api/definitions/${id}/confirm`, {});
    expect(confirmed.body.definition.status).toBe("confirmed");
    const edited = await call("POST", `/api/definitions/${id}/versions`, {
      generalText: "  Packaged processes.  ",
      usageText: "What a Pod groups together.",
    });
    expect(edited.body.definition.current).toMatchObject({ generalText: "Packaged processes.", provenance: "user_confirmed" });
    const detail = await call("GET", `/api/definitions/${id}`);
    expect(detail.body.versions.map((v: { provenance: string }) => v.provenance)).toEqual([
      "user_confirmed",
      "user_confirmed",
      "ai_suggested",
    ]);
    expect((await call("POST", `/api/definitions/${id}/versions`, { generalText: " ", usageText: "x" })).status).toBe(422);
  });

  it("keeps the entry when drafting fails, and redraft recovers", async () => {
    const { nodeId, ai } = await conversationWith();
    setFakeMode({ mode: "fail" });
    const id = (await call("POST", "/api/definitions", select(ai, "Containers", nodeId))).body.definition.id;
    await drainDrafts();
    expect((await call("GET", `/api/definitions/${id}`)).body.definition.status).toBe("failed");
    expect((await call("POST", `/api/definitions/${id}/confirm`, {})).status).toBe(409);
    setFakeMode({ mode: "ok" });
    expect((await call("POST", `/api/definitions/${id}/redraft`, {})).status).toBe(202);
    await drainDrafts();
    expect((await call("GET", `/api/definitions/${id}`)).body.definition.status).toBe("draft");
    expect((await call("POST", `/api/definitions/${id}/redraft`, {})).status).toBe(409);
  });

  it("refuses selections that don't match a completed message", async () => {
    const { nodeId, ai } = await conversationWith();
    expect((await call("POST", "/api/definitions", { ...select(ai, "Containers", nodeId), text: "Other" })).status).toBe(422);
    const other = await conversationWith("x");
    expect((await call("POST", "/api/definitions", select(ai, "Containers", other.nodeId))).status).toBe(422);
  });

  it("lists entries newest first and serves a compact index", async () => {
    const { nodeId, ai } = await conversationWith();
    await call("POST", "/api/definitions", select(ai, "Containers", nodeId));
    await call("POST", "/api/definitions", select(ai, "mentioned", nodeId));
    const list = await call("GET", "/api/definitions");
    expect(list.body.definitions.map((d: { term: string }) => d.term)).toEqual(["mentioned", "Containers"]);
    const index = await call("GET", "/api/definitions?index=1");
    expect(index.body.terms.map((t: { termKey: string }) => t.termKey).sort()).toEqual(["containers", "mentioned"]);
  });
});
