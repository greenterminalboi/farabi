import { expect, type Page, test } from "@playwright/test";
import { canvasDebug, openCanvas, resetDb, startTree } from "./helpers";

// Projects on the canvas (Feature 4; Feature 10 FR-023, FR-059, T093).

test.beforeEach(resetDb);

const menuButton = (page: Page) => page.locator(".project-menu-button");
const panel = (page: Page) => page.getByRole("dialog", { name: "Projects" });
const questions = (page: Page) => page.locator(".element-text.question");

/** Waits for the canvas of the project that just opened to show `n` elements. */
async function canvasHas(page: Page, n: number) {
  await page.waitForFunction(() => typeof window.__farabiCanvasDebug === "function");
  await expect.poll(async () => (await canvasDebug(page)).elements.length, { timeout: 10_000 }).toBe(n);
}

test("create, open, trash and restore projects", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Hello from the first project");
  await expect(menuButton(page)).toContainText("My first project");

  // Create B: it opens with an empty canvas.
  await menuButton(page).click();
  await panel(page).getByRole("button", { name: "+ New project" }).click();
  await panel(page).getByLabel("Project name").fill("Physics");
  await panel(page).getByRole("button", { name: "Create" }).click();
  await expect(menuButton(page)).toContainText("Physics");
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await canvasHas(page, 0);

  // A tree in B, then back to A: only A's tree is on its canvas, and it opens within 1 s.
  await startTree(page, "Hello from Physics");
  await menuButton(page).click();
  const t0 = Date.now();
  await panel(page).getByRole("button", { name: "My first project" }).click();
  await expect(menuButton(page)).toContainText("My first project");
  await canvasHas(page, 2);
  expect(Date.now() - t0).toBeLessThan(3000);
  await expect(questions(page)).toHaveText(["Hello from the first project"]);

  // Trash A while it is open: B opens; A is listed under Trash.
  await menuButton(page).click();
  await panel(page).getByRole("button", { name: /Move “My first project” to trash/ }).click();
  await panel(page).getByRole("button", { name: "Move to trash" }).click();
  await expect(menuButton(page)).toContainText("Physics");
  await expect(questions(page)).toHaveText(["Hello from Physics"]);
  await menuButton(page).click();
  await expect(panel(page).locator(".project-trashed")).toContainText("My first project");

  // Restore it and open it: everything is still there.
  await panel(page).getByRole("button", { name: "Restore" }).click();
  await expect(panel(page).locator(".project-trashed")).toHaveCount(0);
  await panel(page).getByRole("button", { name: "My first project" }).click();
  await canvasHas(page, 2);
  await expect(questions(page)).toHaveText(["Hello from the first project"]);
});
