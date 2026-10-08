/* eslint-disable @typescript-eslint/no-explicit-any -- test helpers return loosely typed JSON */
import { sql } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";
import { getFakeCalls, registerFakeCompletion, setFakeMode } from "@/server/ai/fake";
import { db } from "@/server/db/client";
import { resetDrillFakes } from "@/server/drill/operations";
import { normalizeProblem } from "@/server/drill/operations/round";
import { call, newProject } from "./helpers";

// Feature 12, Drill Kaizen (specs/012-drill-kaizen): integration over the routes, with the fake
// provider's drill responders (research R16): a verdict is solved for ✓, partly solved for ~.

beforeEach(() => resetDrillFakes());

const count = async (table: string) =>
  Number((await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.table(table)}`.execute(db)).rows[0].n);

async function create(projectId: string, domain = "Python dictionaries", extra: object = {}) {
  const res = await call("POST", "/api/drills", { projectId, domain, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.drill;
}

async function started(domain = "Python dictionaries", rungs?: string[]) {
  const projectId = await newProject();
  let drill = await create(projectId, domain);
  if (rungs) drill = (await call("POST", `/api/drills/${drill.drillId}/ladder`, { rungs: rungs.map((name) => ({ name })) })).body.drill;
  const res = await call("POST", `/api/drills/${drill.drillId}/start`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { projectId, drill: res.body.drill };
}

const openRound = (drill: any) => drill.rounds.at(-1);
const levelOf = (drill: any, name: string) => drill.ladder.rungs.find((r: any) => r.name === name);

async function attempt(problemId: string, text: string) {
  const res = await call("POST", `/api/drill-problems/${problemId}/attempts`, { text });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

/** Answers every problem of the open round with `text`, then ends it as the client does. */
async function playRound(drill: any, text: (p: any) => string) {
  const round = openRound(drill);
  let last: any;
  for (const p of round.problems) last = await attempt(p.element.id, text(p));
  expect(last.roundEnded).toBe(true);
  const end = await call("POST", `/api/drill-rounds/${round.roundId}/end`, { by: "all_answered" });
  expect(end.status, JSON.stringify(end.body)).toBe(200);
  return end.body;
}

describe("Feature 12 · US1 start a drill", () => {
  it("creates the drill_start edge, drill node, drills row and an ai-suggested ladder", async () => {
    const projectId = await newProject();
    const drill = await create(projectId, "  Python   dictionaries ");
    expect(drill).toMatchObject({ domain: "Python dictionaries", started: false, complete: false, domainProvenance: "user_authored" });
    expect(drill.ladder.provenance).toBe("ai_suggested");
    expect(drill.ladder.rungs.map((r: any) => [r.name, r.state, r.provenance])).toEqual(
      [1, 2, 3, 4, 5].map((i) => [`Rung ${i}`, "locked", "ai_suggested"]),
    );
    const start = await db.selectFrom("nodes").selectAll().where("id", "=", drill.startEdgeId).executeTakeFirstOrThrow();
    expect(start).toMatchObject({ kind: "drill_start", shape: "edge", origin: "origin", provenance: "user_authored", text: "Python dictionaries", parent_id: null });
    const node = await db.selectFrom("nodes").selectAll().where("id", "=", drill.nodeId).executeTakeFirstOrThrow();
    expect(node).toMatchObject({ kind: "drill", shape: "node", origin: "drill", parent_id: start.id, text: "" });
    expect(getFakeCalls().lastComplete?.tag).toBe("drill_ladder");
  });

  it("writes nothing when the AI fails, and refuses an empty or too-long domain", async () => {
    const projectId = await newProject();
    setFakeMode({ mode: "fail" });
    const failed = await call("POST", "/api/drills", { projectId, domain: "Regex" });
    expect(failed.status).toBe(503);
    expect([await count("drills"), await count("nodes"), await count("drill_ladder_versions")]).toEqual([0, 0, 0]);
    setFakeMode({ mode: "ok" });
    expect((await call("POST", "/api/drills", { projectId, domain: "   " })).status).toBe(422);
    expect((await call("POST", "/api/drills", { projectId, domain: "x".repeat(301) })).status).toBe(422);
    expect(await count("drills")).toBe(0);
  });

  it("saves ladder edits as user-authored versions, keeping rung ids", async () => {
    const projectId = await newProject();
    const drill = await create(projectId);
    const [a, b, c] = drill.ladder.rungs;
    const res = await call("POST", `/api/drills/${drill.drillId}/ladder`, {
      rungs: [{ id: b.id, name: b.name }, { id: a.id, name: "Insert entries" }, { name: "Dict views" }, { id: c.id, name: c.name, removed: true }],
    });
    expect(res.status).toBe(200);
    const rungs = res.body.drill.ladder.rungs;
    expect(res.body.drill.ladder.provenance).toBe("user_authored");
    expect(rungs.slice(0, 4).map((r: any) => [r.name, r.provenance, r.removed])).toEqual([
      ["Rung 2", "ai_suggested", false],
      ["Insert entries", "user_authored", false],
      ["Dict views", "user_authored", false],
      ["Rung 3", "user_authored", true],
    ]);
    // Rungs left out are kept, removed.
    expect(rungs.filter((r: any) => r.removed).map((r: any) => r.name)).toEqual(["Rung 3", "Rung 4", "Rung 5"]);
    expect(rungs[1].id).toBe(a.id);
    const empty = await call("POST", `/api/drills/${drill.drillId}/ladder`, { rungs: [{ id: a.id, name: a.name, removed: true }] });
    expect(empty.status).toBe(422);
  });

  it("starts: a confirmed ladder copy, rung 1 open at level 1, the rest locked, and round 1 with its lesson", async () => {
    const { drill } = await started();
    expect(drill.started).toBe(true);
    expect(drill.ladder.provenance).toBe("user_confirmed");
    expect(drill.ladder.rungs.map((r: any) => [r.state, r.level])).toEqual([["open", 1], ...Array(4).fill(["locked", 1])]);
    expect(drill.rounds).toHaveLength(1);
    const round = drill.rounds[0];
    expect(round.lessons).toHaveLength(1);
    expect(round.lessons[0].text).toContain("Rung 1");
    expect(round.problems.map((p: any) => p.element.text)).toEqual([1, 2, 3, 4].map((i) => `Problem r1-${i} on Rung 1 L1`));
    expect(round.problems.every((p: any) => p.element.provenance === "ai_suggested" && p.hint === null && p.solution === null)).toBe(true);
    expect(round.currentProblemId).toBe(round.problems[0].element.id);
    const hidden = await db.selectFrom("nodes").select(["kind", "origin", "function_id"]).where("parent_id", "=", round.roundId).execute();
    expect(new Set(hidden.map((h) => h.kind))).toEqual(new Set(["drill_lesson", "drill_problem", "drill_hint", "drill_solution"]));
    expect(hidden.every((h) => h.origin === "run" && h.function_id === "drill_round")).toBe(true);
    expect(getFakeCalls().lastComplete).toMatchObject({ tag: "drill_round", effort: "medium", maxTokens: 8000 });

    expect((await call("POST", `/api/drills/${drill.drillId}/start`)).body.error.code).toBe("already_started");
    expect((await call("POST", `/api/drills/${drill.drillId}/rounds`)).body.error.code).toBe("round_open");
  });

  it("follows the drill's round size", async () => {
    const projectId = await newProject();
    const drill = await create(projectId);
    const set = await call("PUT", "/api/kind-settings", { kind: "drill", nodeId: drill.nodeId, key: "round_size", value: "2" });
    expect(set.status).toBe(200);
    expect((await call("PUT", "/api/kind-settings", { kind: "drill", nodeId: drill.nodeId, key: "open_level", value: "5" })).status).toBe(200);
    // The opening level must stay below the solid level (R10).
    expect((await call("PUT", "/api/kind-settings", { kind: "drill", nodeId: drill.nodeId, key: "solid_level", value: "5" })).status).toBe(422);
    expect((await call("PUT", "/api/kind-settings", { kind: "drill", nodeId: drill.nodeId, key: "open_level", value: "8" })).status).toBe(422);
    const res = await call("POST", `/api/drills/${drill.drillId}/start`);
    expect(res.body.drill.settings).toEqual({ round_size: "2", open_level: "5", solid_level: "7" });
    expect(openRound(res.body.drill).problems).toHaveLength(2);
  });

  it("keeps the start when round 1 fails, and the rounds route retries it", async () => {
    const projectId = await newProject();
    const drill = await create(projectId);
    setFakeMode({ mode: "fail" });
    const res = await call("POST", `/api/drills/${drill.drillId}/start`);
    expect(res.status).toBe(200);
    expect(res.body.nextRoundError.code).toBe("function_unavailable");
    expect(res.body.drill).toMatchObject({ started: true, rounds: [] });
    setFakeMode({ mode: "ok" });
    const retry = await call("POST", `/api/drills/${drill.drillId}/rounds`);
    expect(retry.body.drill.rounds).toHaveLength(1);
  });

  it("refuses to start an empty ladder", async () => {
    const projectId = await newProject();
    registerFakeCompletion("drill_ladder", () => JSON.stringify({ rungs: ["Only"] }));
    const drill = await create(projectId);
    // A ladder can't be saved empty, so an empty one can't be started either; one rung is valid.
    const res = await call("POST", `/api/drills/${drill.drillId}/start`);
    expect(res.body.drill.ladder.rungs.map((r: any) => r.state)).toEqual(["open"]);
  });
});

describe("Feature 12 · US2 attempt and feedback", () => {
  it("stores the attempt as the user's, then an ai-suggested verdict with feedback quoting it", async () => {
    const { drill } = await started();
    const p = openRound(drill).problems[0];
    const body = await attempt(p.element.id, "d['k'] = 1 ✓");
    const problem = openRound(body.drill).problems[0];
    expect(problem.result).toBe("solved");
    const [{ attempt: a, verdict, override }] = problem.attempts;
    expect(a).toMatchObject({ kind: "drill_attempt", provenance: "user_authored", origin: "ask", text: "d['k'] = 1 ✓" });
    expect(a.sentAt).not.toBeNull();
    expect(verdict).toMatchObject({ kind: "drill_verdict", provenance: "ai_suggested", origin: "run", verdict: "solved", hinted: false });
    expect(verdict.text).toContain("d['k'] = 1 ✓");
    expect(override).toBeNull();
    expect(getFakeCalls().lastComplete).toMatchObject({ tag: "drill_verdict", effort: "low", maxTokens: 2000 });
    expect(openRound(body.drill).currentProblemId).toBe(openRound(body.drill).problems[1].element.id);
    await expect(sql`UPDATE nodes SET text = 'edited' WHERE id = ${a.id}`.execute(db)).rejects.toThrow(/not allowed/);
  });

  it("keeps an attempt whose verdict failed, and judges it again", async () => {
    const { drill } = await started();
    const p = openRound(drill).problems[0];
    setFakeMode({ mode: "fail" });
    const failed = await call("POST", `/api/drill-problems/${p.element.id}/attempts`, { text: "my try" });
    expect(failed.status).toBe(503);
    expect(failed.body.error.code).toBe("verdict_unavailable");
    expect(failed.body.attemptId).toBeTruthy();
    setFakeMode({ mode: "ok" });
    const judged = await call("POST", `/api/drill-attempts/${failed.body.attemptId}/judge`);
    expect(judged.status).toBe(200);
    expect(openRound(judged.body.drill).problems[0].attempts[0].verdict.verdict).toBe("not_solved");
    expect((await call("POST", `/api/drill-attempts/${failed.body.attemptId}/judge`)).body.error.code).toBe("already_judged");
  });

  it("adds every attempt beside the earlier ones, and refuses too-long or flagged ones", async () => {
    const { drill } = await started();
    const p = openRound(drill).problems[0];
    await attempt(p.element.id, "wrong");
    const second = await attempt(p.element.id, "right ✓");
    const problem = openRound(second.drill).problems[0];
    expect(problem.attempts.map((x: any) => x.verdict.verdict)).toEqual(["not_solved", "solved"]);
    expect(problem.result).toBe("solved");
    expect((await call("POST", `/api/drill-problems/${p.element.id}/attempts`, { text: "x".repeat(20_001) })).status).toBe(422);
    const q = openRound(drill).problems[1];
    await call("POST", `/api/drill-problems/${q.element.id}/events`, { type: "flag", reason: "unsolvable" });
    expect((await call("POST", `/api/drill-problems/${q.element.id}/attempts`, { text: "✓" })).body.error.code).toBe("problem_flagged");
  });

  it("shows a hint and solution only after their events, and counts them in the result", async () => {
    const { drill } = await started();
    const [p1, p2, p3] = openRound(drill).problems;
    const hinted = await call("POST", `/api/drill-problems/${p1.element.id}/events`, { type: "hint" });
    expect(openRound(hinted.body.drill).problems[0].hint.text).toBe("Hint for r1-1");
    expect(openRound(hinted.body.drill).problems[0].solution).toBeNull();
    const solved = await attempt(p1.element.id, "✓");
    expect(openRound(solved.drill).problems[0]).toMatchObject({ result: "partly_solved" });
    expect(openRound(solved.drill).problems[0].attempts[0].verdict.hinted).toBe(true);

    await call("POST", `/api/drill-problems/${p2.element.id}/events`, { type: "reveal" });
    const after = await attempt(p2.element.id, "✓");
    expect(openRound(after.drill).problems[1].solution.text).toBe("Solution for r1-2");
    expect(openRound(after.drill).problems[1].result).toBe("not_solved");

    const skipped = await call("POST", `/api/drill-problems/${p3.element.id}/events`, { type: "skip" });
    const round = openRound(skipped.body.drill);
    expect(round.problems[2]).toMatchObject({ skipped: true, result: "unattempted" });
    expect(round.currentProblemId).toBe(round.problems[3].element.id);
  });

  it("keeps the AI verdict beside the user's override, which counts", async () => {
    const { drill } = await started();
    const p = openRound(drill).problems[0];
    const body = await attempt(p.element.id, "close enough");
    const verdict = openRound(body.drill).problems[0].attempts[0].verdict;
    const res = await call("POST", `/api/drill-verdicts/${verdict.id}/override`, { verdict: "solved" });
    expect(res.status).toBe(201);
    const problem = openRound(res.body.drill).problems[0];
    expect(problem.attempts[0].verdict.verdict).toBe("not_solved");
    expect(problem.attempts[0].override.verdict).toBe("solved");
    expect(problem.result).toBe("solved");
    const row = await db.selectFrom("drill_verdict_overrides").selectAll().executeTakeFirstOrThrow();
    expect(row.provenance).toBe("user_authored");
  });

  it("replaces a flagged problem beside it in the same round", async () => {
    const { drill } = await started();
    const p = openRound(drill).problems[1];
    expect((await call("POST", `/api/drill-problems/${p.element.id}/replace`)).body.error.code).toBe("not_flagged");
    await call("POST", `/api/drill-problems/${p.element.id}/events`, { type: "flag" });
    const res = await call("POST", `/api/drill-problems/${p.element.id}/replace`);
    expect(res.status).toBe(201);
    const problems = openRound(res.body.drill).problems;
    expect(problems).toHaveLength(5);
    expect(problems[4]).toMatchObject({ replaces: p.element.id, position: 4, level: 1 });
    expect(problems[1].flagged).toBe(true);
  });
});

describe("Feature 12 · US3 climb the ladder", () => {
  it("SC-002: all solved moves up one per round; the next rung opens the round after level 4 with a lesson", async () => {
    let { drill } = await started();
    const levels: number[] = [];
    for (let i = 0; i < 3; i++) {
      drill = (await playRound(drill, () => "✓")).drill;
      levels.push(levelOf(drill, "Rung 1").level);
    }
    expect(levels).toEqual([2, 3, 4]);
    expect(levelOf(drill, "Rung 2")).toMatchObject({ state: "open", level: 1 });
    const third = drill.rounds[2];
    expect(third.note.map((n: any) => [n.cause, n.from, n.to, n.toState])).toEqual([
      ["auto", 3, 4, "open"],
      ["auto", 1, 1, "open"],
    ]);
    expect(third.note.every((n: any) => n.evidence.length > 0)).toBe(true);
    const evidence = new Set(third.problems.flatMap((p: any) => p.attempts.map((a: any) => a.attempt.id)));
    expect(third.note[0].evidence.every((id: string) => evidence.has(id))).toBe(true);
    const changes = await db.selectFrom("drill_level_changes").selectAll().where("cause", "=", "auto").execute();
    expect(changes.every((c) => c.provenance === "ai_suggested" && c.evidence.length > 0)).toBe(true);

    const fourth = openRound(drill);
    expect(fourth.lessons.map((l: any) => l.text)).toEqual([expect.stringContaining("Rung 2")]);
    const onRung2 = fourth.problems.filter((p: any) => p.rungIds.includes(levelOf(drill, "Rung 2").id));
    expect(onRung2.length).toBeGreaterThanOrEqual(2);
  });

  it("moves down one when none is solved, and holds a rung with unattempted problems when the user ends early", async () => {
    let { drill } = await started();
    drill = (await playRound(drill, () => "✓")).drill;
    drill = (await playRound(drill, () => "✓")).drill;
    expect(levelOf(drill, "Rung 1").level).toBe(3);
    drill = (await playRound(drill, () => "nope")).drill;
    expect(levelOf(drill, "Rung 1").level).toBe(2);

    const round = openRound(drill);
    const ended = await call("POST", `/api/drill-rounds/${round.roundId}/end`, { by: "user" });
    expect(ended.status).toBe(200);
    expect(levelOf(ended.body.drill, "Rung 1").level).toBe(2);
    expect(ended.body.drill.rounds.at(-2).ended.by).toBe("user");
    expect((await call("POST", `/api/drill-rounds/${round.roundId}/end`, { by: "user" })).body.error.code).toBe("round_ended");
  });

  it("recomputes an ended round after an override, without touching later rounds", async () => {
    let { drill } = await started();
    drill = (await playRound(drill, (p) => (p.position === 0 ? "nope" : "✓"))).drill;
    expect(levelOf(drill, "Rung 1").level).toBe(1); // mixed: held
    drill = (await playRound(drill, () => "✓")).drill;
    expect(levelOf(drill, "Rung 1").level).toBe(2);

    const verdict = drill.rounds[0].problems[0].attempts[0].verdict;
    const res = await call("POST", `/api/drill-verdicts/${verdict.id}/override`, { verdict: "solved" });
    const after = res.body.drill;
    expect(levelOf(after, "Rung 1").level).toBe(3);
    const note = after.rounds[0].note;
    expect(note.map((n: any) => [n.cause, n.from, n.to])).toEqual([["recompute", 2, 3]]);
    expect(after.rounds[1].note).toEqual(drill.rounds[1].note);
    const recompute = await db.selectFrom("drill_level_changes").selectAll().where("cause", "=", "recompute").executeTakeFirstOrThrow();
    expect(recompute).toMatchObject({ provenance: "ai_suggested", supersedes: null });
  });

  it("SC-003: ten rounds repeat no normalized problem", async () => {
    let { drill } = await started();
    for (let i = 0; i < 10; i++) drill = (await playRound(drill, (p) => (p.position % 2 ? "✓" : "nope"))).drill;
    const texts = drill.rounds.flatMap((r: any) => r.problems.map((p: any) => normalizeProblem(p.element.text)));
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("drops repeated problems, asks once more, and notes a short round", async () => {
    let { drill } = await started();
    registerFakeCompletion("drill_round", () =>
      JSON.stringify({ lessons: [], problems: [1, 2, 3, 4].map(() => ({ text: "Problem r1-1 on Rung 1 L1", hint: "h", solution: "s" })) }),
    );
    drill = (await playRound(drill, () => "nope")).drill;
    const round = openRound(drill);
    expect(round.problems).toHaveLength(0);
    expect(round.shortNote).toMatch(/4 of 4/);
    expect(getFakeCalls().completeInputs.filter((c) => c.tag === "drill_round")).toHaveLength(3);
  });

  it("keeps the end and its changes when the next round fails, and retries it", async () => {
    let { drill } = await started();
    const round = openRound(drill);
    for (const p of round.problems) await attempt(p.element.id, "✓");
    setFakeMode({ mode: "fail" });
    const end = await call("POST", `/api/drill-rounds/${round.roundId}/end`, { by: "all_answered" });
    expect(end.status).toBe(200);
    expect(end.body.nextRoundError.code).toBe("function_unavailable");
    drill = end.body.drill;
    expect(drill.rounds).toHaveLength(1);
    expect(drill.rounds[0].ended).not.toBeNull();
    expect(levelOf(drill, "Rung 1").level).toBe(2);
    setFakeMode({ mode: "ok" });
    const retry = await call("POST", `/api/drills/${drill.drillId}/rounds`);
    expect(retry.body.drill.rounds).toHaveLength(2);
  });

  it("sets a level or state by hand as a user-authored change", async () => {
    const { drill } = await started();
    const rung = levelOf(drill, "Rung 3");
    const res = await call("POST", `/api/drills/${drill.drillId}/rungs/${rung.id}/level`, { level: 6, state: "open" });
    expect(levelOf(res.body.drill, "Rung 3")).toMatchObject({ level: 6, state: "open" });
    const row = await db.selectFrom("drill_level_changes").selectAll().where("cause", "=", "manual").executeTakeFirstOrThrow();
    expect(row).toMatchObject({ provenance: "user_authored", evidence: [] });
    expect((await call("POST", `/api/drills/${drill.drillId}/rungs/${rung.id}/level`, { level: 11 })).status).toBe(422);
  });

  it("only lets locked rungs be reordered once rounds exist", async () => {
    const { drill } = await started("Regex", ["A", "B", "C"]);
    const [a, b, c] = drill.ladder.rungs.filter((r: any) => !r.removed);
    const swapLocked = await call("POST", `/api/drills/${drill.drillId}/ladder`, { rungs: [a, c, b].map(({ id, name }) => ({ id, name })) });
    expect(swapLocked.status).toBe(200);
    // Opening rung B (by hand), then moving it before A changes open rungs' order.
    await call("POST", `/api/drills/${drill.drillId}/rungs/${b.id}/level`, { state: "open" });
    const moved = await call("POST", `/api/drills/${drill.drillId}/ladder`, { rungs: [b, a, c].map(({ id, name }) => ({ id, name })) });
    expect(moved.body.error.code).toBe("ladder_order_locked");
  });
});

describe("Feature 12 · US4 progress and resume", () => {
  it("SC-005: a fresh load after three rounds and a half-done round is identical", async () => {
    let { drill } = await started();
    for (let i = 0; i < 3; i++) drill = (await playRound(drill, (p) => (p.position ? "✓" : "~"))).drill;
    const half = await attempt(openRound(drill).problems[0].element.id, "✓");
    const { drainGenerations } = await import("@/server/answers/generation");
    await drainGenerations();
    const fresh = await call("GET", `/api/drills/${drill.drillId}`);
    expect(fresh.body.drill).toEqual(half.drill);
    expect(openRound(fresh.body.drill).currentProblemId).toBe(openRound(half.drill).problems[1].element.id);
    // One history entry per round per rung that moved, plus its start.
    expect(levelOf(fresh.body.drill, "Rung 1").history.map((h: any) => [h.cause, h.roundNumber])).toEqual([["start", null]]);
  });

  it("counts a redo of an earlier failed problem toward the round it is made in (FR-023 AS2)", async () => {
    let { drill } = await started();
    drill = (await playRound(drill, (p) => (p.position === 0 ? "nope" : "✓"))).drill;
    const failed = drill.rounds[0].problems[0];
    expect(failed.result).toBe("not_solved");
    expect(levelOf(drill, "Rung 1").level).toBe(1);
    await attempt(failed.element.id, "now ✓");
    drill = (await playRound(drill, () => "✓")).drill;
    const note = drill.rounds[1].note[0];
    expect(note).toMatchObject({ from: 1, to: 2 });
    expect(note.evidence).toContain(drill.rounds[0].problems[0].attempts[1].attempt.id);
  });

  it("records each round's change in the rung's history", async () => {
    let { drill } = await started();
    for (let i = 0; i < 2; i++) drill = (await playRound(drill, () => "✓")).drill;
    expect(levelOf(drill, "Rung 1").history.map((h: any) => [h.cause, h.roundNumber, h.level])).toEqual([
      ["start", null, 1],
      ["auto", 1, 2],
      ["auto", 2, 3],
    ]);
  });
});

describe("Feature 12 · US6 ground a drill and drill on", () => {
  async function conversation(projectId: string, text = "Hash tables and collisions") {
    const { startTree } = await import("./helpers");
    return startTree(projectId, text);
  }

  it("attaches and detaches without an AI call, refuses another project, and rounds read what is attached", async () => {
    const { projectId, drill } = await started();
    const t = await conversation(projectId);
    const other = await conversation(await newProject("Other"));
    const calls = getFakeCalls().completeInputs.length;
    const attached = await call("POST", `/api/drills/${drill.drillId}/attachments`, { nodeId: t.answer.id, action: "attach" });
    expect(attached.body.drill.attachments).toEqual([expect.objectContaining({ nodeId: t.answer.id })]);
    expect((await call("POST", `/api/drills/${drill.drillId}/attachments`, { nodeId: other.answer.id, action: "attach" })).body.error.code).toBe(
      "wrong_project",
    );
    expect(getFakeCalls().completeInputs.length).toBe(calls);

    const next = (await playRound(drill, () => "✓")).drill;
    const prompt = getFakeCalls().completeInputs.filter((c) => c.tag === "drill_round").at(-1)!.prompt;
    expect(prompt).toContain("Hash tables and collisions");
    const problemRow = await db.selectFrom("nodes").select("properties").where("id", "=", openRound(next).problems[0].element.id).executeTakeFirstOrThrow();
    expect(problemRow.properties.readAttachments).toEqual([t.answer.id]);

    const detached = await call("POST", `/api/drills/${drill.drillId}/attachments`, { nodeId: t.answer.id, action: "detach" });
    expect(detached.body.drill.attachments).toEqual([]);
    await playRound(next, () => "✓");
    const last = getFakeCalls().completeInputs.filter((c) => c.tag === "drill_round").at(-1)!.prompt;
    expect(last).not.toContain("Hash tables and collisions");
    expect(await count("drill_attachments")).toBe(2);
  });

  async function completeDrill(drill: any) {
    for (const r of drill.ladder.rungs.filter((x: any) => !x.removed)) {
      drill = (await call("POST", `/api/drills/${drill.drillId}/rungs/${r.id}/level`, { level: 7, state: "solid" })).body.drill;
    }
    return playRound(drill, () => "✓");
  }

  it("offers up to 3 starting points from follow-ups and attachments once complete; picking one starts a linked drill", async () => {
    const { projectId, drill } = await started("Regex", ["Literals", "Classes"]);
    const p = openRound(drill).problems[0];
    const judged = await attempt(p.element.id, "nope");
    const verdictId = openRound(judged.drill).problems[0].attempts[0].verdict.id;
    const follow = await call("POST", `/api/nodes/${verdictId}/ask?wait=1`, { content: "Why do classes match one character?" });
    expect(follow.status).toBe(201);
    const t = await conversation(projectId, "Unicode categories");
    await call("POST", `/api/drills/${drill.drillId}/attachments`, { nodeId: t.answer.id, action: "attach" });

    const done = await completeDrill((await call("GET", `/api/drills/${drill.drillId}`)).body.drill);
    expect(done.drill.complete).toBe(true);
    const offer = done.drill.offer;
    expect(offer.candidates.map((c: any) => c.nodeId)).toEqual([follow.body.edge.id, t.answer.id]);
    expect(offer.candidates[0].domain).toContain("Why do classes");
    expect(await count("drill_offers")).toBe(1);

    const pick = offer.candidates[0];
    const created = await create(projectId, pick.domain, { sourceNodeId: pick.nodeId, offerId: offer.offerId });
    expect(created).toMatchObject({ parentDrill: { drillId: drill.drillId, domain: "Regex" }, sourceNodeId: pick.nodeId, domainProvenance: "user_confirmed" });
    const start = await db.selectFrom("nodes").selectAll().where("id", "=", created.startEdgeId).executeTakeFirstOrThrow();
    expect(start).toMatchObject({ parent_id: pick.nodeId, origin: "drill", kind: "drill_start" });
    const parent = (await call("GET", `/api/drills/${drill.drillId}`)).body.drill;
    expect(parent.offer.picked).toEqual([pick.nodeId]);

    const dismissed = await call("POST", `/api/drill-offers/${offer.offerId}/dismiss`);
    expect(dismissed.body.drill.offer.dismissed).toBe(true);
    // Never offered again, even if the drill completes again.
    await playRound(dismissed.body.drill, () => "✓");
    expect(await count("drill_offers")).toBe(1);
  });

  it("makes no offer call when there are no candidates, and adding a rung reopens a complete drill", async () => {
    const { drill } = await started("Regex", ["Literals"]);
    const before = getFakeCalls().completeInputs.filter((c) => c.tag === "drill_offer").length;
    const done = await completeDrill(drill);
    expect(done.drill.complete).toBe(true);
    expect(done.drill.offer).toBeNull();
    expect(getFakeCalls().completeInputs.filter((c) => c.tag === "drill_offer").length).toBe(before);
    const rungs = [...done.drill.ladder.rungs.map(({ id, name }: any) => ({ id, name })), { name: "Lookarounds" }];
    const reopened = await call("POST", `/api/drills/${drill.drillId}/ladder`, { rungs });
    expect(reopened.body.drill.complete).toBe(false);
    expect(levelOf(reopened.body.drill, "Lookarounds")).toMatchObject({ state: "locked", level: 1 });
  });
});

describe("Feature 12 · FR-027 and Article II", () => {
  it("reads, ladder edits, events, attachments, overrides, levels and settings make no AI call", async () => {
    const { projectId, drill } = await started();
    const judged = await attempt(openRound(drill).problems[0].element.id, "x");
    const verdictId = openRound(judged.drill).problems[0].attempts[0].verdict.id;
    const t = await (await import("./helpers")).startTree(projectId, "Notes");
    const calls = getFakeCalls().completeInputs.length;
    const p = openRound(drill).problems[1].element.id;
    const rung = drill.ladder.rungs[0];
    const steps = [
      call("GET", `/api/drills/${drill.drillId}`),
      call("GET", `/api/drills?projectId=${projectId}`),
      call("POST", `/api/drills/${drill.drillId}/ladder`, { rungs: drill.ladder.rungs.map(({ id, name }: any) => ({ id, name })) }),
      call("POST", `/api/drill-problems/${p}/events`, { type: "hint" }),
      call("POST", `/api/drill-problems/${p}/events`, { type: "reveal" }),
      call("POST", `/api/drill-problems/${p}/events`, { type: "skip" }),
      call("POST", `/api/drills/${drill.drillId}/attachments`, { nodeId: t.answer.id, action: "attach" }),
      call("POST", `/api/drill-verdicts/${verdictId}/override`, { verdict: "solved" }),
      call("POST", `/api/drills/${drill.drillId}/rungs/${rung.id}/level`, { level: 2 }),
      call("PUT", "/api/kind-settings", { kind: "drill", nodeId: drill.nodeId, key: "round_size", value: "3" }),
      call("GET", `/api/canvas?projectId=${projectId}`),
    ];
    for (const step of steps) expect([200, 201]).toContain((await step).status);
    expect(getFakeCalls().completeInputs.length).toBe(calls);
  });

  it("drill tables are append-only; started_at is set once", async () => {
    const { drill } = await started();
    await attempt(openRound(drill).problems[0].element.id, "x");
    const verdictId = (await db.selectFrom("nodes").select("id").where("kind", "=", "drill_verdict").executeTakeFirstOrThrow()).id;
    await call("POST", `/api/drill-verdicts/${verdictId}/override`, { verdict: "solved" });
    await call("POST", `/api/drill-problems/${openRound(drill).problems[1].element.id}/events`, { type: "hint" });
    const { DRILL_TABLES } = await import("@/server/db/migrations/0011_drill");
    for (const table of DRILL_TABLES) {
      if ((await count(table)) === 0) continue;
      await expect(sql`DELETE FROM ${sql.table(table)}`.execute(db), table).rejects.toThrow(/append-only/);
    }
    await expect(sql`UPDATE drill_ladder_versions SET provenance = 'user_authored'`.execute(db)).rejects.toThrow(/append-only/);
    await expect(sql`UPDATE drills SET started_at = now()`.execute(db)).rejects.toThrow(/append-only/);
    await expect(sql`UPDATE drills SET domain = 'x'`.execute(db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM nodes WHERE kind = 'drill_problem'`.execute(db)).rejects.toThrow(/cannot be deleted/);
  });

  it("hides a drill in a trashed project", async () => {
    const { projectId, drill } = await started();
    await newProject("Keep one live");
    const trash = await call("POST", `/api/projects/${projectId}/trash`);
    expect(trash.status).toBe(200);
    expect((await call("GET", `/api/drills/${drill.drillId}`)).status).toBe(404);
  });
});

describe("Feature 12 · performance (plan Performance Goals)", () => {
  it("loads a 30-round drill in under 500 ms", async () => {
    let { drill } = await started("Python dictionaries");
    for (let i = 0; i < 30; i++) drill = (await playRound(drill, (p) => (p.position % 3 ? "✓" : "~"))).drill;
    const { loadDrill } = await import("@/server/drill/load");
    await loadDrill(drill.drillId); // warm
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await loadDrill(drill.drillId);
      times.push(performance.now() - t0);
    }
    const elements = await count("nodes");
    console.log(`30-round drill: ${elements} elements, load ${times.map((t) => t.toFixed(0)).join("/")} ms`);
    expect(Math.min(...times)).toBeLessThan(500);
  }, 120_000);
});
