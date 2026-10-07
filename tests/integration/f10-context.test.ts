import { describe, expect, it } from "vitest";
import { setFakeMode } from "@/server/ai/fake";
import { buildReplyInput } from "@/server/graph/context";
import { askAndWait, call, newProject, startTree } from "./helpers";

// Feature 10, FR-007 and research R6: a reply's context is the ancestor path of its question
// edge, origin first, and nothing from siblings or descendants.

const user = (content: string) => ({ role: "user", content });
const ai = (content: string) => ({ role: "ai", content });
const echo = (q: string) => `Echo: ${q}. **Containers are mentioned here.**`;

async function tree(first = "Pods") {
  const projectId = await newProject();
  return startTree(projectId, first);
}

function spanOf(text: string, phrase: string) {
  const start = text.indexOf(phrase);
  if (start < 0) throw new Error(`no "${phrase}" in ${text}`);
  return { start, end: start + phrase.length, text: phrase };
}

describe("Feature 10 · reply context", () => {
  it("is the linear path from the origin", async () => {
    const t = await tree("Pods");
    const second = (await askAndWait(t.answer.id, "Services")).body;
    const third = (await askAndWait(second.answer.id, "Ingress")).body;
    const input = await buildReplyInput(third.answer.id);
    expect(input.inheritedContext).toEqual([]);
    expect(input.anchorText).toBeNull();
    expect(input.messages).toEqual([
      user("Pods"),
      ai(echo("Pods")),
      user("Services"),
      ai(echo("Services")),
      user("Ingress"),
    ]);
  });

  it("passes the anchor for a branch from an answer span", async () => {
    const t = await tree("Pods");
    const span = spanOf(t.answer.text, "Containers");
    const branch = await call("POST", `/api/nodes/${t.answer.id}/branches`, span);
    expect(branch.status).toBe(201);
    const sent = await call("POST", `/api/edges/${branch.body.edge.id}/send?wait=1`, { content: "Why?" });
    const input = await buildReplyInput(sent.body.answer.id);
    expect(input.anchorText).toBe("Containers");
    expect(input.messages).toEqual([user("Pods"), ai(echo("Pods")), user("Why?")]);
  });

  it("includes a question edge but not its answer for a branch from the edge's own words", async () => {
    const t = await tree("Pods");
    const q2 = (await askAndWait(t.answer.id, "Tell me about Services")).body;
    const branch = await call("POST", `/api/nodes/${q2.edge.id}/branches`, spanOf(q2.edge.text, "Services"));
    expect(branch.body.edge.parentId).toBe(q2.edge.id);
    const sent = await call("POST", `/api/edges/${branch.body.edge.id}/send?wait=1`, { content: "Only that word" });
    const input = await buildReplyInput(sent.body.answer.id);
    expect(input.anchorText).toBe("Services");
    expect(input.messages).toEqual([user("Pods"), ai(echo("Pods")), user("Tell me about Services"), user("Only that word")]);
  });

  it("puts two user messages in a row when asking from an edge", async () => {
    const t = await tree("Pods");
    const q2 = (await askAndWait(t.answer.id, "Services")).body;
    const again = (await askAndWait(q2.edge.id, "And another thing")).body;
    expect(again.edge.parentId).toBe(q2.edge.id);
    const input = await buildReplyInput(again.answer.id);
    expect(input.messages).toEqual([user("Pods"), ai(echo("Pods")), user("Services"), user("And another thing")]);
  });

  it("leaves out an answer that didn't complete", async () => {
    const t = await tree("Pods");
    setFakeMode({ mode: "stall" });
    const cut = (await askAndWait(t.answer.id, "Cut me off")).body;
    expect(cut.answer.status).toBe("incomplete");
    setFakeMode({ mode: "ok" });
    const next = (await askAndWait(cut.answer.id, "Go on")).body;
    const input = await buildReplyInput(next.answer.id);
    expect(input.messages).toEqual([user("Pods"), ai(echo("Pods")), user("Cut me off"), user("Go on")]);
  });

  it("never includes a sibling attempt or a sibling branch (FR-007)", async () => {
    const t = await tree("Pods");
    const a = (await askAndWait(t.answer.id, "Left")).body;
    const b = (await askAndWait(t.answer.id, "Right")).body;
    expect(b.edge.parentId).toBe(a.edge.parentId);
    const inputB = await buildReplyInput(b.answer.id);
    expect(inputB.messages).toEqual([user("Pods"), ai(echo("Pods")), user("Right")]);

    const regen = await call("POST", `/api/edges/${a.edge.id}/attempts?wait=1`, { mode: "regenerate" });
    expect(regen.status).toBe(201);
    const fromNew = (await askAndWait(regen.body.answer.id, "Deeper")).body;
    const input = await buildReplyInput(fromNew.answer.id);
    expect(input.messages).toEqual([user("Pods"), ai(echo("Pods")), user("Left"), ai(echo("Left")), user("Deeper")]);
    expect(input.messages.filter((m) => m.role === "ai")).toHaveLength(2);
  });

  it("reads the level and model from the answer's own row", async () => {
    const t = await tree("Pods");
    const input = await buildReplyInput(t.answer.id);
    expect(input.pressureLevel).toBe(t.answer.pressureLevel);
    expect(input.model).toBe(t.answer.replyModel);
  });
});
