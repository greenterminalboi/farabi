/* eslint-disable @typescript-eslint/no-explicit-any -- API JSON in tests */
import { expect, type Page } from "@playwright/test";

// Feature 12 e2e helpers: set a drill up through the API where the step isn't what's under test.
// The fake provider's drill responders answer (research R16): ✓ solves, ~ partly solves.

export async function currentProjectId(page: Page): Promise<string> {
  const res = await page.request.get("/api/projects");
  return (await res.json()).currentId;
}

export async function apiDrill(page: Page, domain = "Python dictionaries", opts: { roundSize?: number; rungs?: string[]; start?: boolean } = {}) {
  const projectId = await currentProjectId(page);
  let drill = (await (await page.request.post("/api/drills", { data: { projectId, domain } })).json()).drill;
  if (opts.rungs) {
    drill = (await (await page.request.post(`/api/drills/${drill.drillId}/ladder`, { data: { rungs: opts.rungs.map((name) => ({ name })) } })).json()).drill;
  }
  if (opts.roundSize) {
    const res = await page.request.put("/api/kind-settings", { data: { kind: "drill", nodeId: drill.nodeId, key: "round_size", value: String(opts.roundSize) } });
    expect(res.ok()).toBeTruthy();
  }
  if (opts.start !== false) drill = (await (await page.request.post(`/api/drills/${drill.drillId}/start`)).json()).drill;
  return { projectId, drill };
}

export async function apiAttempt(page: Page, problemId: string, text: string) {
  const res = await page.request.post(`/api/drill-problems/${problemId}/attempts`, { data: { text } });
  expect(res.status()).toBe(201);
  return (await res.json()) as { drill: any; roundEnded: boolean };
}

/** Answers every problem of the open round through the API, then ends it as the client does. */
export async function apiRound(page: Page, drill: any, text: (p: any) => string) {
  const round = drill.rounds.at(-1);
  for (const p of round.problems) await apiAttempt(page, p.element.id, text(p));
  const res = await page.request.post(`/api/drill-rounds/${round.roundId}/end`, { data: { by: "all_answered" } });
  return (await res.json()).drill;
}

/** Opens a drill screen and closes the auto-shown lesson, if any. */
export async function openDrill(page: Page, drillId: string, { closeLesson = true } = {}) {
  await page.goto(`/drill/${drillId}`);
  await expect(page.locator(".drill-ladder")).toBeVisible();
  // A round answered before the page opened ends on load and the next is written first.
  await page.waitForLoadState("networkidle");
  if (closeLesson && (await page.getByTestId("drill-lesson").count())) await page.getByRole("button", { name: "Got it" }).click();
}

/** Submits an answer to the problem on screen and waits for its verdict. */
export async function answer(page: Page, text: string) {
  const problem = page.getByTestId("drill-current-problem");
  const before = await problem.getByTestId("drill-verdict").count();
  await problem.getByTestId("drill-answer").fill(text);
  await problem.getByTestId("drill-submit").click();
  await expect(problem.getByTestId("drill-verdict")).toHaveCount(before + 1);
}
