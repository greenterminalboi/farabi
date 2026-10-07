import { describe, expect, it } from "vitest";
import { getFakeCalls, setFakeMode } from "@/server/ai/fake";
import { db } from "@/server/db/client";
import { drainDrafts } from "@/server/definitions/draftQueue";
import { askAndWait, call, startTree } from "./helpers";

// Feature 2 definitions, re-targeted to v2 elements (Feature 10, FR-055, T090).

/** The open (cookie-less default) project, which the definitions list reads. */
async function openProject(): Promise<string> {
  return (await call("GET", "/api/projects")).body.currentId;
}

async function conversationWith(text = "Tell me about Pods") {
  const t = await startTree(await openProject(), text);
  return { nodeId: t.answer.id as string, ai: t.answer, edge: t.edge };
}

function select(ai: { text: string }, phrase: string, nodeId: string) {
  const start = ai.text.indexOf(phrase);
  return { nodeId, start, end: start + phrase.length, text: phrase };
}

describe("Feature 2 (v2) · definitions", () => {
  it("captures a term and drafts a two-part ai_suggested definition", async () => {
    const { nodeId, ai } = await conversationWith();
    const res = await call("POST", "/api/definitions", select(ai, "Containers", nodeId));
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    expect(res.body.definition).toMatchObject({
      term: "Containers",
      termKey: "containers",
      source: { elementId: nodeId, kind: "answer", excerpt: ai.text.replace(/\s+/g, " ") },
    });
    await drainDrafts();
    const got = await call("GET", `/api/definitions/${res.body.definition.id}`);
    expect(got.body.definition.status).toBe("draft");
    expect(got.body.definition.current).toMatchObject({
      generalText: "General meaning of Containers.",
      usageText: "Here, Containers refers to what the conversation discussed.",
      provenance: "ai_suggested",
    });
  });

  it("drafts from the source element and its path, never a sibling", async () => {
    const { nodeId } = await conversationWith("the path");
    await askAndWait(nodeId, "sibling only text");
    const other = (await askAndWait(nodeId, "branch talk")).body.answer;
    await call("POST", "/api/definitions", select(other, "mentioned", other.id));
    await drainDrafts();
    const input = getFakeCalls().lastDefine!;
    expect(input.term).toBe("mentioned");
    expect(input.sourceMessage).toEqual({ role: "ai", content: other.text });
    const said = input.messages.map((m) => m.content).join(" ");
    expect(said).toContain("the path");
    expect(said).not.toContain("sibling only text");
  });

  it("captures from a question edge's own words and from a function output (FR-055)", async () => {
    const { nodeId, edge } = await conversationWith("Tell me about Pods");
    const fromEdge = await call("POST", "/api/definitions", select(edge, "Pods", edge.id));
    expect(fromEdge.status).toBe(201);
    expect(fromEdge.body.definition.source).toMatchObject({ elementId: edge.id, kind: "question" });
    const out = (await call("POST", `/api/nodes/${nodeId}/functions/analogy/run`)).body.output;
    const fromOutput = await call("POST", "/api/definitions", select(out, "Fake", out.id));
    expect(fromOutput.status).toBe(201);
    expect(fromOutput.body.definition.source.kind).toBe("analogy");
  });

  it("never duplicates a term, whatever its case, spacing or conversation", async () => {
    const a = await conversationWith();
    const first = await call("POST", "/api/definitions", select(a.ai, "Containers", a.nodeId));
    const b = await conversationWith("containers everywhere");
    const again = await call("POST", "/api/definitions", select(b.ai, "Containers", b.nodeId));
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.definition.id).toBe(first.body.definition.id);
    expect(again.body.definition.source.elementId).toBe(a.nodeId); // first capture wins
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

  it("refuses selections that don't match the element's final text", async () => {
    const { nodeId, ai } = await conversationWith();
    expect((await call("POST", "/api/definitions", { ...select(ai, "Containers", nodeId), text: "Other" })).status).toBe(422);
    const other = await conversationWith("x");
    expect((await call("POST", "/api/definitions", select(ai, "Containers", other.nodeId))).status).toBe(422);
    setFakeMode({ mode: "stall" });
    const cut = (await askAndWait(nodeId, "cut")).body.answer;
    const res = await call("POST", "/api/definitions", { nodeId: cut.id, start: 0, end: 4, text: cut.text.slice(0, 4) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("not_branchable");
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
