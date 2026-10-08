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

async function start(content: string, terms?: Array<string | { id: string; via: "detected" | "chip" }>) {
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
    // The edge also records how each term arrived; a bare id is a chip added by hand.
    const edgeUses = uses.map((u) => ({ ...u, via: "chip" }));
    expect(edge.lexicon).toEqual(edgeUses);
    expect(answer.lexicon).toEqual(uses);
    expect(await props(edge.id)).toEqual({ lexicon: edgeUses });
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
    expect(sent.body.edge.lexicon).toEqual([{ id: "eli5", v: v("eli5"), via: "chip" }]);
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
    expect(quick.body.edge.lexicon).toEqual([{ id: "table", v: v("table"), via: "chip" }]);
    expect(lastReply().lexicon?.map((t) => t.id)).toEqual(["table"]);
  });

  it("refuses invalid selections with a reason, storing nothing (FR-008, SC-005)", async () => {
    const projectId = await newProject();
    const bad: Array<[string[], RegExp]> = [
      [["concise", "comprehensive"], /Scope already set: Concise/],
      [["distill", "comprehensive"], /Conflicts with Distill/],
      [["nope"], /Unknown term "nope"/],
      [["table", "table"], /Already added/],
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

describe("Feature 13 · auto-detect: how terms arrived, and no count limit (owner decision 2026-10-07)", () => {
  it("records via per term on the edge, not on the answer", async () => {
    const { res } = await start("Summarize this as a table", [
      { id: "table", via: "chip" },
      { id: "summarize", via: "detected" },
      { id: "must", via: "detected" },
    ]);
    expect(res.status).toBe(201);
    const edgeUses = [
      { id: "summarize", v: v("summarize"), via: "detected" },
      { id: "table", v: v("table"), via: "chip" },
      { id: "must", v: v("must"), via: "detected" },
    ];
    expect(res.body.edge.lexicon).toEqual(edgeUses);
    expect(await props(res.body.edge.id)).toEqual({ lexicon: edgeUses });
    expect(res.body.answer.lexicon).toEqual(edgeUses.map(({ id, v }) => ({ id, v })));
    expect(res.body.edge.text).toBe("Summarize this as a table");
    expect(lastReply().lexicon?.map((t) => t.id)).toEqual(["summarize", "table", "must"]);
  });

  it("via is recorded on ask and on send too", async () => {
    const { res } = await start("Pods");
    const next = await call("POST", `/api/nodes/${res.body.answer.id}/ask?wait=1`, { content: "Be blunt", terms: [{ id: "direct", via: "detected" }] });
    expect(next.body.edge.lexicon).toEqual([{ id: "direct", v: v("direct"), via: "detected" }]);
    const answerText = (await db.selectFrom("nodes").select("text").where("id", "=", res.body.answer.id).executeTakeFirstOrThrow()).text!;
    const branch = await call("POST", `/api/nodes/${res.body.answer.id}/branches`, spanOf(answerText, "Containers"));
    const sent = await call("POST", `/api/edges/${branch.body.edge.id}/send?wait=1`, { content: "ELI5", terms: [{ id: "eli5", via: "detected" }] });
    expect(sent.body.edge.lexicon).toEqual([{ id: "eli5", v: v("eli5"), via: "detected" }]);
  });

  it("rows recorded before via still read and validate", async () => {
    const { usesOf } = await import("@/server/lexicon/resolve");
    const { validateProperties } = await import("@/server/graph/elements");
    expect(usesOf({ lexicon: [{ id: "table", v: 1 }] })).toEqual([{ id: "table", v: 1 }]);
    expect(usesOf({ lexicon: [{ id: "table", v: 1, via: "maybe" }] })).toEqual([]);
    expect(validateProperties("question", { lexicon: [{ id: "table", v: 1 }] })).toEqual({ lexicon: [{ id: "table", v: 1 }] });
  });

  it("takes more than six terms, and still refuses slot and conflict clashes", async () => {
    const many = ["distill", "concise", "table", "direct", "skeptic", "must", "never", "only", "edge-cases", "think-first"];
    const { res } = await start("Many terms", many.map((id) => ({ id, via: "detected" as const })));
    expect(res.status).toBe(201);
    expect(res.body.edge.lexicon).toHaveLength(10);
    const projectId = await newProject();
    for (const [terms, reason] of [
      [[{ id: "formal", via: "detected" }, { id: "conversational", via: "detected" }], /Tone already set: Formal/],
      [[{ id: "verbatim", via: "chip" }, { id: "simplify", via: "detected" }], /Conflicts with Verbatim/],
    ] as const) {
      const bad = await call("POST", "/api/trees", { projectId, content: "x", terms });
      expect(bad.status).toBe(422);
      expect(bad.body.error.message).toMatch(reason);
    }
    const wrongVia = await call("POST", "/api/trees", { projectId, content: "x", terms: [{ id: "table", via: "guessed" }] });
    expect(wrongVia.status).toBe(422);
    await drainGenerations();
  });
});

describe("Feature 13 · the auto-detect setting", () => {
  it("is on by default, is stored as user-authored history, and takes only booleans", async () => {
    const { resolveConfig } = await import("@/server/settings/config");
    expect(resolveConfig("lexicon_autodetect")).toEqual({ value: true, source: "default", changedAt: null });
    // Not read from the environment.
    process.env.LEXICON_AUTODETECT = "false";
    try {
      expect(resolveConfig("lexicon_autodetect").value).toBe(true);
    } finally {
      delete process.env.LEXICON_AUTODETECT;
    }
    const off = await call("PUT", "/api/settings/app", { key: "lexicon_autodetect", value: false });
    expect(off.status).toBe(200);
    expect(off.body.config.lexicon_autodetect).toMatchObject({ value: false, source: "row" });
    expect((await call("GET", "/api/settings/app")).body.config.lexicon_autodetect.value).toBe(false);
    expect((await call("PUT", "/api/settings/app", { key: "lexicon_autodetect", value: "no" })).status).toBe(422);
    const rows = await db.selectFrom("setting_changes").select(["value", "provenance"]).where("key", "=", "lexicon_autodetect").execute();
    expect(rows).toEqual([{ value: false, provenance: "user_authored" }]);
    // The database refuses a value that isn't a boolean (migration 0014).
    await expect(sql`INSERT INTO setting_changes (key, value) VALUES ('lexicon_autodetect', '"off"'::jsonb)`.execute(db)).rejects.toThrow(/lexicon_autodetect/);
    await call("PUT", "/api/settings/app", { key: "lexicon_autodetect", value: true });
  });
});
