import { expect, test } from "@playwright/test";
import { answer, apiDrill, openDrill } from "./drill-helpers";
import { resetDb, setAiMode } from "./helpers";

// Feature 12, story 3: rounds end by themselves, levels move, and the next rung opens with a lesson.

test.beforeEach(async ({ page }) => {
  await resetDb();
  await setAiMode(page, "ok");
});

test("a fully answered round ends with a note and a new round; level 4 opens rung 2 with its lesson", async ({ page }) => {
  await page.goto("/");
  const { drill } = await apiDrill(page, "Python dictionaries", { roundSize: 2 });
  await openDrill(page, drill.drillId);
  const problem = page.getByTestId("drill-current-problem");

  for (let round = 1; round <= 3; round++) {
    await expect(problem).toContainText(`Problem r${round}-1`);
    await answer(page, "✓");
    await problem.getByTestId("drill-next").click();
    await expect(problem).toContainText(`Problem r${round}-2`);
    await answer(page, "✓");
    // The round ends by itself and the next one is written; the verdict stays until Next.
    await expect(page.locator(".drill-strip .drill-label")).toHaveText(`Round ${round + 1}`, { timeout: 15_000 });
    await expect(problem.getByTestId("drill-verdict")).toHaveAttribute("data-verdict", "solved");
    await expect(page.getByTestId("drill-round-note")).toContainText(`level ${round} → ${round + 1}`);
    await expect(page.getByTestId("drill-rung-0")).toContainText(`L${round + 1}`);
    await problem.getByTestId("drill-next").click();
    if (round < 3) await expect(page.getByTestId("drill-lesson")).toHaveCount(0);
  }
  await expect(page.getByTestId("drill-round-note")).toContainText("Rung 2: opened at level 1");
  await expect(page.getByTestId("drill-lesson")).toContainText("Lesson on Rung 2");
  await page.getByRole("button", { name: "Got it" }).click();
  // A mixed round: the newest rung and a review of rung 1.
  await expect(problem).toContainText("on Rung 2 L1");
  await expect(page.getByTestId("drill-rung-1")).toContainText("open");
});

test("End round ends early; the round note says nothing moved for unattempted rungs", async ({ page }) => {
  await page.goto("/");
  const { drill } = await apiDrill(page);
  await openDrill(page, drill.drillId);
  await page.getByTestId("drill-end-round").click();
  await expect(page.locator(".drill-strip .drill-label")).toHaveText("Round 2");
  await expect(page.getByTestId("drill-round-note")).toContainText("No level changed");
});
