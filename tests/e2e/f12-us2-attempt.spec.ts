import { expect, test } from "@playwright/test";
import { answer, apiDrill, openDrill } from "./drill-helpers";
import { resetDb, setAiMode } from "./helpers";

// Feature 12, story 2: attempt one problem at a time and get feedback.

test.beforeEach(async ({ page }) => {
  await resetDb();
  await setAiMode(page, "ok");
});

test("verdicts, Next, Try again, hint, solution, override, and reopening from the strip", async ({ page }) => {
  await page.goto("/");
  const { drill } = await apiDrill(page);
  await openDrill(page, drill.drillId);
  const problem = page.getByTestId("drill-current-problem");

  await expect(problem).toContainText("Problem r1-1");
  await answer(page, "d['k'] = 1 ✓");
  await expect(problem.getByTestId("drill-verdict")).toHaveAttribute("data-verdict", "solved");
  await expect(problem.getByTestId("drill-verdict")).toContainText("You wrote: \"d['k'] = 1 ✓\"");
  await expect(problem.getByTestId("drill-verdict").locator(".ai-tag")).toBeVisible();
  await problem.getByTestId("drill-next").click();

  await expect(problem).toContainText("Problem r1-2");
  await answer(page, "no idea");
  await expect(problem.getByTestId("drill-verdict")).toHaveAttribute("data-verdict", "not_solved");
  await problem.getByRole("button", { name: "Try again" }).click();
  await answer(page, "now ✓");
  await expect(problem.getByTestId("drill-verdict")).toHaveCount(2);
  // Override the first verdict: both are kept, the user's counts.
  await problem.getByTestId("drill-override").first().selectOption("partly_solved");
  await expect(problem.locator(".drill-badge.overridden")).toHaveCount(1);
  await expect(problem).toContainText("You: Partly solved ✓ counts");
  await problem.getByTestId("drill-next").click();

  await expect(problem).toContainText("Problem r1-3");
  await problem.getByRole("button", { name: "Hint" }).click();
  await expect(problem.locator(".drill-hint")).toContainText("Hint for r1-3");
  await problem.getByRole("button", { name: "Show solution" }).click();
  await expect(problem.locator(".drill-solution")).toContainText("Solution for r1-3");

  // Only one problem is open; earlier ones reopen from the strip.
  await expect(page.getByTestId("drill-current-problem")).toHaveCount(1);
  await page.locator(".drill-chip").first().click();
  await expect(problem).toContainText("Problem r1-1");
  await expect(problem.getByTestId("drill-verdict")).toHaveAttribute("data-verdict", "solved");
});

test("an attempt whose verdict fails is kept, and Judge again judges it", async ({ page }) => {
  await page.goto("/");
  const { drill } = await apiDrill(page);
  await openDrill(page, drill.drillId);
  const problem = page.getByTestId("drill-current-problem");
  await setAiMode(page, "fail");
  await problem.getByTestId("drill-answer").fill("my try ✓");
  await problem.getByTestId("drill-submit").click();
  await expect(page.locator(".drill-main > .drill-error")).toContainText("saved");
  await expect(problem.locator(".drill-attempt-text")).toContainText("my try ✓");
  await setAiMode(page, "ok");
  await problem.getByRole("button", { name: "Judge again" }).click();
  await expect(problem.getByTestId("drill-verdict")).toHaveAttribute("data-verdict", "solved");
});
