/* eslint-disable @typescript-eslint/no-explicit-any -- test helpers return loosely typed JSON */
import { sql } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { resetDrillFakes } from "@/server/drill/operations";
import { buildReplyInput } from "@/server/graph/context";
import { askAndWait, call, newProject } from "./helpers";

// Feature 12, US5 (FR-026, FR-030, research R3): follow-ups and branches from drill text are
// ordinary v0.2 elements: asked with the existing routes, given the drill path as context, drawn
// from the drill card on the canvas, and never changing the drill's state.

beforeEach(() => resetDrillFakes());

const DRILL_TABLES = [
  "drills",
  "drill_ladder_versions",
  "drill_level_changes",
  "drill_round_ends",
  "drill_problem_events",
  "drill_verdict_overrides",
  "drill_attachments",
  "drill_offers",
  "drill_offer_events",
];
const counts = async () =>
  Promise.all(DRILL_TABLES.map(async (t) => Number((await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.table(t)}`.execute(db)).rows[0].n)));

async function judgedProblem() {
  const projectId = await newProject();
  const created = await call("POST", "/api/drills", { projectId, domain: "Python dictionaries" });
  const drill = (await call("POST", `/api/drills/${created.body.drill.drillId}/start`)).body.drill;
  const problem = drill.rounds[0].problems[0];
  const judged = await call("POST", `/api/drill-problems/${problem.element.id}/attempts`, { text: "d.get('k')" });
  const after = judged.body.drill.rounds[0];
  return { projectId, drill: judged.body.drill, problem: after.problems[0], other: after.problems[1], lesson: after.lessons[0] };
}

describe("Feature 12 · US5 follow-ups and branches", () => {
  it("a follow-up on a verdict is a question edge with domain, problem, attempt and verdict as context", async () => {
    const { projectId, drill, problem } = await judgedProblem();
    const before = await counts();
    const verdict = problem.attempts[0].verdict;
    const asked = await askAndWait(verdict.id, "Why not d['k']?");
    expect(asked.status).toBe(201);
    expect(asked.body.edge).toMatchObject({ kind: "question", parentId: verdict.id, provenance: "user_authored" });
    expect(asked.body.answer.status).toBe("complete");
    const input = await buildReplyInput(asked.body.answer.id);
    expect(input.messages).toEqual([
      { role: "user", content: "Python dictionaries" },
      { role: "ai", content: problem.element.text },
      { role: "user", content: "d.get('k')" },
      { role: "ai", content: verdict.text },
      { role: "user", content: "Why not d['k']?" },
    ]);
    expect(await counts()).toEqual(before);

    const reloaded = (await call("GET", `/api/drills/${drill.drillId}`)).body.drill;
    expect(reloaded.rounds[0].problems[0].followUps).toEqual([expect.objectContaining({ edgeId: asked.body.edge.id, text: "Why not d['k']?" })]);

    const canvas = (await call("GET", `/api/canvas?projectId=${projectId}`)).body;
    const kinds = new Set(canvas.elements.map((e: any) => e.kind));
    expect(kinds).toEqual(new Set(["drill_start", "drill", "question", "answer"]));
    const edge = canvas.elements.find((e: any) => e.id === asked.body.edge.id);
    expect(edge.drawnFrom).toBe(drill.nodeId);
    const card = canvas.elements.find((e: any) => e.kind === "drill").card;
    expect(card).toEqual({ title: "Python dictionaries", lines: ["Rung 1: Rung 1 · level 1"], href: `/drill/${drill.drillId}` });
  });

  it("a follow-up on an unattempted problem leaves from the problem", async () => {
    const { drill, other } = await judgedProblem();
    const asked = await askAndWait(other.element.id, "What does this ask?");
    expect(asked.body.edge.parentId).toBe(other.element.id);
    const input = await buildReplyInput(asked.body.answer.id);
    expect(input.messages.map((m) => m.role)).toEqual(["user", "ai", "user"]);
    const reloaded = (await call("GET", `/api/drills/${drill.drillId}`)).body.drill;
    expect(reloaded.rounds[0].problems[1].followUps).toHaveLength(1);
  });

  it("Branch, Define and Park work on drill text and change nothing in the drill", async () => {
    const { problem, lesson } = await judgedProblem();
    const before = await counts();
    const span = (text: string, phrase: string) => {
      const start = text.indexOf(phrase);
      return { start, end: start + phrase.length, text: phrase };
    };
    const branch = await call("POST", `/api/nodes/${problem.element.id}/branches`, span(problem.element.text, "Rung 1"));
    expect(branch.status).toBe(201);
    expect(branch.body.edge.anchor.text).toBe("Rung 1");
    const bad = await call("POST", `/api/nodes/${problem.element.id}/branches`, { start: 0, end: 4, text: "nope" });
    expect(bad.status).toBe(422);
    const park = await call("POST", `/api/nodes/${lesson.id}/parked`, span(lesson.text, "worked example"));
    expect(park.status).toBe(201);
    const define = await call("POST", "/api/definitions", { nodeId: lesson.id, ...span(lesson.text, "worked example") });
    expect([200, 201]).toContain(define.status);
    expect(await counts()).toEqual(before);
  });
});
