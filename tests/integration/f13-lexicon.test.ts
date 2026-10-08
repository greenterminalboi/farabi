import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { getFakeCalls } from "@/server/ai/fake";
import { drainGenerations } from "@/server/answers/generation";
import { db } from "@/server/db/client";
import { findTerm } from "@/shared/lexicon";
import { call, newProject } from "./helpers";

// Feature 13: lexicon terms on messages (contracts/http-api.md, contracts/prompt.md).

const v = (id: string) => findTerm(id)!.version;
const props = async (id: string) =>
  (await db.selectFrom("nodes").select("properties").where("id", "=", id).executeTakeFirstOrThrow()).properties;
const lastReply = () => getFakeCalls().replyInputs.at(-1)!;

function spanOf(text: string, phrase: string) {
  const start = text.indexOf(phrase);
  return { start, end: start + phrase.length, text: phrase };
}

async function start(content: string, terms?: string[]) {
  const projectId = await newProject();
  const res = await call("POST", "/api/trees?wait=1", { projectId, content, terms });
  return { projectId, res };
}

describe("Feature 13 · terms on a message (story 1)", () => {
  it("records the terms on the edge and the answer, keeps the text verbatim and sends one block", async () => {
    const { res } = await start("What did the paper find?", ["table", "distill"]);
    expect(res.status).toBe(201);
    const { edge, answer } = res.body;
    expect(edge.text).toBe("What did the paper find?");
    // Recorded in slot order.
    const uses = [
      { id: "distill", v: v("distill") },
      { id: "table", v: v("table") },
    ];
    expect(edge.lexicon).toEqual(uses);
    expect(answer.lexicon).toEqual(uses);
    expect(await props(edge.id)).toEqual({ lexicon: uses });
    expect(await props(answer.id)).toEqual({ lexicon: uses });
    const input = lastReply();
    expect(input.messages).toEqual([{ role: "user", content: "What did the paper find?" }]);
    expect(input.lexicon?.map((t) => t.id)).toEqual(["distill", "table"]);
    expect(input.lexicon?.[0].instruction).toBe(findTerm("distill")!.instruction);
  });

  it("stores nothing extra without terms, and sends no block", async () => {
    const { res } = await start("Plain question");
    expect(res.body.edge.lexicon).toBeUndefined();
    expect(await props(res.body.edge.id)).toEqual({});
    expect(await props(res.body.answer.id)).toEqual({});
    expect(lastReply().lexicon).toBeUndefined();
  });

  it("only the answered message's terms reach a reply, not earlier ones", async () => {
    const { res } = await start("First", ["distill"]);
    const next = await call("POST", `/api/nodes/${res.body.answer.id}/ask?wait=1`, { content: "Second", terms: ["skeptic"] });
    expect(next.status).toBe(201);
    expect(lastReply().messages.map((m) => m.content)[0]).toBe("First");
    expect(lastReply().lexicon?.map((t) => t.id)).toEqual(["skeptic"]);
    const plain = await call("POST", `/api/nodes/${next.body.answer.id}/ask?wait=1`, { content: "Third" });
    expect(plain.body.edge.lexicon).toBeUndefined();
    expect(lastReply().lexicon).toBeUndefined();
  });

  it("an unsent branch edge gets its terms when it is sent", async () => {
    const { res } = await start("Pods");
    const answerText = (await db.selectFrom("nodes").select("text").where("id", "=", res.body.answer.id).executeTakeFirstOrThrow()).text!;
    const branch = await call("POST", `/api/nodes/${res.body.answer.id}/branches`, spanOf(answerText, "Containers"));
    const sent = await call("POST", `/api/edges/${branch.body.edge.id}/send?wait=1`, { content: "Why?", terms: ["eli5"] });
    expect(sent.status).toBe(201);
    expect(sent.body.edge.lexicon).toEqual([{ id: "eli5", v: v("eli5") }]);
    expect(sent.body.answer.lexicon).toEqual([{ id: "eli5", v: v("eli5") }]);
    expect(lastReply().lexicon?.map((t) => t.id)).toEqual(["eli5"]);
  });

  it("properties stay immutable apart from that one send", async () => {
    const { res } = await start("Pods", ["distill"]);
    await expect(
      sql`UPDATE nodes SET properties = '{}'::jsonb WHERE id = ${res.body.edge.id}`.execute(db),
    ).rejects.toThrow(/never change/);
    await expect(
      sql`UPDATE nodes SET properties = '{}'::jsonb WHERE id = ${res.body.answer.id}`.execute(db),
    ).rejects.toThrow(/never change/);
  });

  it("retry and regenerate record the edge's terms at their current versions", async () => {
    const { res } = await start("Pods", ["concise"]);
    const regen = await call("POST", `/api/edges/${res.body.edge.id}/attempts?wait=1`, { mode: "regenerate" });
    expect(regen.status).toBe(201);
    expect(regen.body.answer.lexicon).toEqual([{ id: "concise", v: v("concise") }]);
    expect(lastReply().lexicon?.map((t) => t.id)).toEqual(["concise"]);
  });

  it("a quick branch keeps the re-asked question's terms and ignores the draft's", async () => {
    const { res } = await start("Origin");
    const q = await call("POST", `/api/nodes/${res.body.answer.id}/ask?wait=1`, { content: "Follow-up", terms: ["table"] });
    const quick = await call("POST", `/api/nodes/${q.body.answer.id}/ask?wait=1`, { content: "????", terms: ["eli5"] });
    expect(quick.body.kind).toBe("quick_branch");
    expect(quick.body.edge.text).toBe("Follow-up");
    expect(quick.body.edge.lexicon).toEqual([{ id: "table", v: v("table") }]);
    expect(lastReply().lexicon?.map((t) => t.id)).toEqual(["table"]);
  });

  it("refuses invalid selections with a reason, storing nothing (FR-008, SC-005)", async () => {
    const projectId = await newProject();
    const bad: Array<[string[], RegExp]> = [
      [["concise", "comprehensive"], /Scope already set: Concise/],
      [["distill", "comprehensive"], /Conflicts with Distill/],
      [["nope"], /Unknown term "nope"/],
      [["table", "table"], /Already added/],
      [["distill", "concise", "table", "direct", "skeptic", "must", "never"], /6/],
    ];
    for (const [terms, reason] of bad) {
      const res = await call("POST", "/api/trees", { projectId, content: "x", terms });
      expect(res.status, terms.join(",")).toBe(422);
      expect(res.body.error.message).toMatch(reason);
    }
    const { count } = await db.selectFrom("nodes").select((eb) => eb.fn.countAll<string>().as("count")).executeTakeFirstOrThrow();
    expect(Number(count)).toBe(0);
    await drainGenerations();
  });
});
