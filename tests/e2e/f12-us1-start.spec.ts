import { expect, test } from "@playwright/test";
import { openCanvas, resetDb, setAiMode } from "./helpers";

// Feature 12, story 1: start a drill on a domain from the canvas (quickstart §2).

test.beforeEach(async ({ page }) => {
  await resetDb();
  await setAiMode(page, "ok");
});

test("New drill proposes a ladder; edit it, start, and see the lesson and the first problem", async ({ page }) => {
  await openCanvas(page);
  await page.getByTestId("new-drill").click();
  await page.getByTestId("drill-domain").fill("Python dictionaries");
  await page.getByRole("button", { name: "Create drill" }).click();
  await page.waitForURL(/\/drill\/[0-9a-f-]+$/);

  const rungs = page.locator(".drill-rung");
  await expect(rungs).toHaveCount(5);
  await expect(page.locator(".drill-ladder-head .ai-tag")).toBeVisible();
  await page.getByLabel("Rung 1 name").fill("Insert entries");
  await page.getByTestId("drill-rung-2").getByRole("button", { name: "Move up" }).click();
  await expect(page.getByLabel("Rung 2 name")).toHaveValue("Rung 3");
  await page.getByTestId("drill-start").click();

  const lesson = page.getByTestId("drill-lesson");
  await expect(lesson).toContainText("Lesson on Insert entries");
  await expect(lesson.locator(".ai-tag")).toBeVisible();
  await page.getByRole("button", { name: "Got it" }).click();
  const problem = page.getByTestId("drill-current-problem");
  await expect(problem).toContainText("Problem r1-1 on Insert entries L1");
  await expect(problem.locator(".ai-tag").first()).toBeVisible();
  await expect(page.locator(".drill-chip")).toHaveCount(4);
  await expect(page.getByTestId("drill-rung-0")).toContainText("open");
  await expect(page.getByTestId("drill-rung-1")).toContainText("locked");
  // The lesson stays reachable from its rung.
  await page.getByTestId("drill-rung-0").getByRole("button", { name: "Lesson" }).click();
  await expect(page.getByTestId("drill-lesson")).toBeVisible();
});

test("a failed ladder proposal keeps the typed domain, creates nothing, and Retry works", async ({ page }) => {
  await openCanvas(page);
  await page.getByTestId("new-drill").click();
  await setAiMode(page, "fail");
  await page.getByTestId("drill-domain").fill("Regular expressions");
  await page.getByRole("button", { name: "Create drill" }).click();
  await expect(page.getByTestId("drill-create").getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("drill-domain")).toHaveValue("Regular expressions");
  const projectId = (await (await page.request.get("/api/projects")).json()).currentId;
  expect((await (await page.request.get(`/api/drills?projectId=${projectId}`)).json()).drills).toEqual([]);
  await setAiMode(page, "ok");
  await page.getByRole("button", { name: "Retry" }).click();
  await page.waitForURL(/\/drill\//);
});
