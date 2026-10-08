import { z } from "zod";
import { beforeAll, describe, expect, it } from "vitest";
import { getFakeCalls, registerFakeCompletion } from "@/server/ai/fake";
import { getAIProvider } from "@/server/ai";
import { db } from "@/server/db/client";
import { buildReplyInput } from "@/server/graph/context";
import { insertElement, loadLive } from "@/server/graph/elements";
import { findKind, registerKind } from "@/shared/kinds";
import { askAndWait, call, newProject, startTree } from "./helpers";

// Feature 12's shared hooks (research R15, C1–C6), exercised with test kinds so they hold without
// any drill code: hidden kinds and drawnFrom on the canvas, context and asking by role, branching
// from run-made turns, completion options and responders, and overrides on any element.

const user = (content: string) => ({ role: "user", content });
const ai = (content: string) => ({ role: "ai", content });
const echo = (q: string) => `Echo: ${q}. **Containers are mentioned here.**`;

beforeAll(() => {
  if (findKind("t12_act")) return;
  registerKind({
    id: "t12_act",
    label: "Hidden act",
    shape: "edge",
    display: "question",
    onCanvas: false,
    contextRole: "user",
    settings: [],
    properties: z.object({}).strict(),
  });
  registerKind({
    id: "t12_turn",
    label: "Hidden turn",
    shape: "node",
    display: "output",
    onCanvas: false,
    contextRole: "ai",
    settings: [],
    properties: z.object({}).strict(),
  });
  const levels = Array.from({ length: 5 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
  registerKind({
    id: "t12_card",
    label: "Card",
    shape: "node",
    display: "drill",
    settings: [
      { key: "low", label: "Low", help: "", type: "choice", choices: levels, default: "2" },
      { key: "high", label: "High", help: "", type: "choice", choices: levels, default: "4" },
    ],
    validateSettings: (v) => (Number(v.low) < Number(v.high) ? null : "Low must be below high"),
    properties: z.object({}).strict(),
  });
});

/** A tree with a hidden act and a run-made hidden turn under its first answer. */
async function hiddenPair() {
  const projectId = await newProject();
  const t = await startTree(projectId, "Pods");
  const answer = await loadLive(db, t.answer.id);
  const act = await insertElement(db, {
    kind: "t12_act",
    parentId: answer.id,
    treeId: answer.tree_id,
    projectId,
    origin: "ask",
    provenance: "user_authored",
    text: "My try",
    sentAt: new Date(),
  });
  const turn = await insertElement(db, {
    kind: "t12_turn",
    parentId: act.id,
    treeId: answer.tree_id,
    projectId,
    origin: "run",
    provenance: "ai_suggested",
    text: "Close, but check the selector.",
    functionId: "t12_fn",
    functionVersion: 1,
  });
  return { projectId, t, act, turn };
}

describe("Feature 12 · shared hooks (C1–C6)", () => {
  it("C1: question and answer declare their context roles; drill draws a node", () => {
    expect(findKind("question")?.contextRole).toBe("user");
    expect(findKind("answer")?.contextRole).toBe("ai");
    expect(findKind("t12_card")?.display).toBe("drill");
  });

  it("C2/C3: a question under a hidden turn is askable, gets the turns as context and is drawn from the nearest shown ancestor", async () => {
    const { projectId, t, turn } = await hiddenPair();
    const asked = await askAndWait(turn.id, "Why the selector?");
    expect(asked.status).toBe(201);
    const input = await buildReplyInput(asked.body.answer.id);
    expect(input.messages).toEqual([
      user("Pods"),
      ai(echo("Pods")),
      user("My try"),
      ai("Close, but check the selector."),
      user("Why the selector?"),
    ]);

    const canvas = await call("GET", `/api/canvas?projectId=${projectId}`);
    const kinds = canvas.body.elements.map((e: { kind: string }) => e.kind);
    expect(kinds).not.toContain("t12_act");
    expect(kinds).not.toContain("t12_turn");
    const edge = canvas.body.elements.find((e: { id: string }) => e.id === asked.body.edge.id);
    expect(edge.parentId).toBe(turn.id);
    expect(edge.drawnFrom).toBe(t.answer.id);
    const answer = canvas.body.elements.find((e: { id: string }) => e.id === asked.body.answer.id);
    expect(answer.drawnFrom).toBeUndefined();
  });

  it("C2: a run-made turn's text can be branched and parked, unlike a leaf output", async () => {
    const { turn } = await hiddenPair();
    const at = turn.text!.indexOf("selector");
    const span = { start: at, end: at + 8, text: "selector" };
    const branch = await call("POST", `/api/nodes/${turn.id}/branches`, span);
    expect(branch.status).toBe(201);
    expect(branch.body.edge.anchor.text).toBe("selector");
    const park = await call("POST", `/api/nodes/${turn.id}/parked`, span);
    expect(park.status).toBe(201);
  });

  it("C4/C5: completion options pass through and a registered responder answers its tag", async () => {
    registerFakeCompletion("t12_tag", (input, n) => `{"model":"${input.model}","n":${n}}`);
    const text = await getAIProvider().complete({
      tag: "t12_tag",
      system: "s",
      prompt: "p",
      model: "claude-test",
      effort: "medium",
      maxTokens: 123,
    });
    expect(JSON.parse(text).model).toBe("claude-test");
    expect(getFakeCalls().lastComplete).toMatchObject({ effort: "medium", maxTokens: 123 });
    expect(await getAIProvider().complete({ tag: "other", system: "s", prompt: "p" })).toMatch(/^Fake other #\d+$/);
  });

  it("C6: any element whose kind declares settings takes an override, checked as a combination", async () => {
    const { projectId, t } = await hiddenPair();
    const answer = await loadLive(db, t.answer.id);
    const edge = await insertElement(db, {
      kind: "question",
      parentId: answer.id,
      treeId: answer.tree_id,
      projectId,
      origin: "ask",
      provenance: "user_authored",
      text: "card",
      sentAt: new Date(),
    });
    const card = await insertElement(db, {
      kind: "t12_card",
      parentId: edge.id,
      treeId: answer.tree_id,
      projectId,
      origin: "ask",
      provenance: "user_authored",
      text: "",
    });
    const ok = await call("PUT", "/api/kind-settings", { kind: "t12_card", nodeId: card.id, key: "high", value: "5" });
    expect(ok.status).toBe(200);
    expect(ok.body.setting).toMatchObject({ value: "5", source: "override" });
    const bad = await call("PUT", "/api/kind-settings", { kind: "t12_card", nodeId: card.id, key: "low", value: "5" });
    expect(bad.status).toBe(422);
    const wrong = await call("PUT", "/api/kind-settings", { kind: "analogy", nodeId: card.id, key: "reach", value: "far" });
    expect(wrong.status).toBe(409);
    const noSettings = await call("PUT", "/api/kind-settings", { kind: "answer", nodeId: answer.id, key: "x", value: "1" });
    expect(noSettings.status).toBe(409);
    // Function-edge-only route is unchanged.
    const edgeRoute = await call("PUT", `/api/edges/${card.id}/settings`, { key: "high", value: "3" });
    expect(edgeRoute.status).toBe(409);
  });
});
