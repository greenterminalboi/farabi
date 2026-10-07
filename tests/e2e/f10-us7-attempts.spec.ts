import { expect, type Page, test } from "@playwright/test";
import { cameraState, elementsOf, focusElement, openCanvas, resetDb, selectInElement, setAiMode, startTree, waitForReplyEnd } from "./helpers";

// Story 7: retry without losing anything (quickstart §3.6; FR-041, FR-042; SC-011).

test.beforeEach(async ({ page }) => {
  await resetDb();
  await setAiMode(page, "ok");
});

const answers = (page: Page) => page.locator(".element-text.answer");

test("Retry on a stopped reply adds a sibling attempt and keeps the partial one (scenario 1)", async ({ page }) => {
  await openCanvas(page);
  await setAiMode(page, "ok", 0, 800);
  const box = page.getByTestId("composer").getByLabel("Message");
  await box.fill("A long answer please");
  await box.press("Enter");
  await expect(page.getByTestId("streaming")).toBeVisible();
  await page.getByTestId("composer").getByRole("button", { name: "Stop" }).click();
  await waitForReplyEnd(page);
  const stopped = answers(page).first();
  await expect(stopped).toHaveAttribute("aria-label", /stopped/);
  const partial = await stopped.locator(".element-body").textContent();

  await setAiMode(page, "ok");
  await stopped.getByRole("button", { name: "Retry" }).click();
  await waitForReplyEnd(page);
  await expect(answers(page)).toHaveCount(2);
  await expect(answers(page).filter({ hasText: "Echo: A long answer please" })).toHaveCount(1);
  await expect(page.getByTestId("attempt")).toHaveText(["attempt 1 of 2", "attempt 2 of 2"]);
  // The first attempt is unchanged, and the camera followed the new one.
  await expect(answers(page).filter({ has: page.getByText("attempt 1 of 2") }).locator(".element-body")).toHaveText(partial!);
  const second = (await elementsOf(page, "answer")).sort((a, b) => b.x - a.x)[0];
  await expect.poll(async () => (await cameraState(page)).target).toBe(second.id);
});

test("Regenerate keeps the earlier answer and its branches (scenarios 2–3, SC-011)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Pods");
  const [original] = await elementsOf(page, "answer");
  // A branch from the original answer.
  await selectInElement(page, original.id, "Containers");
  await page.getByRole("toolbar", { name: "Highlight actions" }).getByRole("button", { name: "Branch" }).click();
  await page.getByTestId("branch-question-form").getByLabel("Your question (optional)").press("Enter");
  await expect(page.locator(`[data-node-id="${original.id}"] [data-markers]`)).toHaveText("Containers");
  const text = await page.locator(`[data-node-id="${original.id}"] .element-body`).textContent();

  await focusElement(page, original.id);
  await page.locator(`[data-node-id="${original.id}"]`).getByRole("button", { name: "↻" }).click();
  await waitForReplyEnd(page);
  await expect(answers(page)).toHaveCount(2);
  // The original keeps its text and its branch marker; the new attempt sits beside it.
  await expect(page.locator(`[data-node-id="${original.id}"] .element-body`)).toHaveText(text!);
  await expect(page.locator(`[data-node-id="${original.id}"] [data-markers]`)).toHaveText("Containers");
  const all = await elementsOf(page, "answer");
  const regenerated = all.find((a) => a.id !== original.id)!;
  expect(regenerated.x).toBeGreaterThan(original.x + original.w);
  await expect(page.locator(`[data-node-id="${regenerated.id}"] [data-testid=attempt]`)).toHaveText("attempt 2 of 2");
});
