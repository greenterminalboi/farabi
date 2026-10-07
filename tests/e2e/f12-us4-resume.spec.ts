import { expect, test } from "@playwright/test";
import { apiAttempt, apiDrill, apiRound, openDrill } from "./drill-helpers";
import { resetDb, setAiMode } from "./helpers";

// Feature 12, story 4: come back later; history, failed problems and the open round are intact.

test.beforeEach(async ({ page }) => {
  await resetDb();
  await setAiMode(page, "ok");
});

test("after three rounds and a reload: sparkline, failed list with Redo, and the open round where it was", async ({ page }) => {
  await page.goto("/");
  let { drill } = await apiDrill(page, "Python dictionaries", { roundSize: 2 });
  drill = await apiRound(page, drill, (p) => (p.position === 0 ? "nope" : "✓"));
  drill = await apiRound(page, drill, () => "✓");
  drill = await apiRound(page, drill, () => "✓");
  await apiAttempt(page, drill.rounds.at(-1).problems[0].element.id, "✓");

  await openDrill(page, drill.drillId);
  await page.reload();
  await expect(page.getByTestId("drill-current-problem")).toContainText("Problem r4-2");
  await expect(page.getByTestId("drill-rung-0").locator(".drill-spark")).toBeVisible();
  const failed = page.getByTestId("drill-failed");
  await expect(failed).toContainText("Problem r1-1");
  await failed.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByTestId("drill-current-problem")).toContainText("Problem r1-1");
  await expect(page.getByTestId("drill-current-problem").getByTestId("drill-verdict")).toHaveAttribute("data-verdict", "not_solved");
});
