import { expect, test } from "@playwright/test";
import { apiAttempt, apiDrill, openDrill } from "./drill-helpers";
import { resetDb, selectInElement, setAiMode } from "./helpers";

// Feature 12, story 5: ask why, and branch out onto the canvas.

test.beforeEach(async ({ page }) => {
  await resetDb();
  await setAiMode(page, "ok");
});

test("a follow-up becomes a canvas branch off the drill card, linked under the problem, with a way back", async ({ page }) => {
  await page.goto("/");
  const { drill } = await apiDrill(page);
  const problemId = drill.rounds[0].problems[0].element.id;
  await apiAttempt(page, problemId, "d.get('k')");
  await openDrill(page, drill.drillId);
  // The attempted problem is no longer the current one; reopen it from the strip.
  await page.locator(".drill-chip").first().click();
  await expect(page.getByTestId("drill-current-problem").getByTestId("drill-verdict")).toBeVisible();

  await page.getByTestId("drill-followup").fill("Why not d['k']?");
  await page.getByRole("button", { name: "Ask on the canvas" }).click();
  const link = page.getByTestId("drill-followup-links").getByRole("link", { name: /Why not/ });
  await expect(link).toBeVisible();
  await expect(page.getByTestId("drill-rung-0")).toContainText("L1");

  await link.click();
  await page.waitForURL(/focus=/);
  const card = page.locator(".element-text.drill");
  await expect(card).toContainText("Python dictionaries");
  await expect(card).toContainText("Rung 1: Rung 1 · level 1");
  await expect(page.locator(".element-text.question", { hasText: "Why not d['k']?" })).toBeVisible();
  await page.getByTestId("back-to-drill").click();
  await expect(page).toHaveURL(new RegExp(`/drill/${drill.drillId}#${problemId}`));
  await expect(page.getByTestId("drill-current-problem")).toContainText("Problem r1-1");
});

test("Define a phrase in a lesson, and Branch from a problem without leaving the drill", async ({ page }) => {
  await page.goto("/");
  const { drill } = await apiDrill(page);
  await openDrill(page, drill.drillId, { closeLesson: false });
  const lesson = drill.rounds[0].lessons[0];
  await selectInElement(page, lesson.id, "worked example");
  await page.getByRole("toolbar", { name: "Highlight actions" }).getByRole("button", { name: /Define/ }).click();
  await expect(page.getByRole("status")).toContainText("worked example");

  await page.getByRole("button", { name: "Got it" }).click();
  const problem = drill.rounds[0].problems[0];
  await selectInElement(page, problem.element.id, "Rung 1");
  await page.getByRole("toolbar", { name: "Highlight actions" }).getByRole("button", { name: /Branch/ }).click();
  await page.getByLabel("Your question (optional)").fill("What is a rung?");
  await page.getByLabel("Your question (optional)").press("Enter");
  await expect(page.getByTestId("drill-followup-links")).toContainText("What is a rung?");
  await expect(page).toHaveURL(new RegExp(`/drill/${drill.drillId}`));
});
