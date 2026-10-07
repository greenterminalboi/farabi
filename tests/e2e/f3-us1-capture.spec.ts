import { expect, type Page, test } from "@playwright/test";
import { elementsOf, openCanvas, resetDb, startTree } from "./helpers";

test.beforeEach(resetDb);

const feedbackButton = (page: Page) => page.getByRole("button", { name: /^Feedback/ });

async function submitFeedback(page: Page, text: string) {
  const drawer = page.getByRole("complementary", { name: "Feedback" });
  if (!(await drawer.isVisible())) await feedbackButton(page).click();
  await drawer.getByLabel("Feedback text").fill(text);
  await drawer.getByRole("button", { name: "Submit feedback" }).click();
  await expect(drawer.getByTestId("feedback-card").first()).toContainText(text);
}

test("capture from the canvas and from Definitions without navigating away (FR-058)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Pods");
  const [answer] = await elementsOf(page, "answer");

  // The button is on every view.
  for (const path of ["/definitions", "/settings", "/"]) {
    await page.goto(path);
    await expect(feedbackButton(page)).toBeVisible();
  }
  await openCanvas(page, `/?focus=${answer.id}`);
  const url = page.url();

  await feedbackButton(page).click();
  const drawer = page.getByRole("complementary", { name: "Feedback" });
  await expect(drawer).toBeVisible();
  expect(page.url()).toBe(url);

  // Whitespace-only text cannot be submitted.
  await drawer.getByLabel("Feedback text").fill("   ");
  await expect(drawer.getByRole("button", { name: "Submit feedback" })).toBeDisabled();

  const t0 = Date.now();
  await submitFeedback(page, "canvas test");
  expect(Date.now() - t0).toBeLessThan(1000); // SC-002
  expect(page.url()).toBe(url);
  const canvasCard = drawer.getByTestId("feedback-card").first();
  await expect(canvasCard).toContainText("Open");
  // It records the open project and the focused element.
  await expect(canvasCard.getByRole("link", { name: "open answer" })).toHaveAttribute("href", `/?focus=${answer.id}`);

  // Switch to Definitions with the drawer open; it stays open.
  await page.getByRole("link", { name: "Definitions", exact: true }).click();
  await page.waitForURL(/\/definitions$/);
  await expect(drawer).toBeVisible();
  await submitFeedback(page, "definitions test");
  const defCard = drawer.getByTestId("feedback-card").first();
  await expect(defCard.locator(".feedback-meta")).toContainText("Definitions");
  await expect(defCard.getByRole("link")).toHaveCount(0);

  // Esc closes the drawer; the count in the button reflects open items.
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(feedbackButton(page)).toContainText("2");
});

test("tags are added as chips and kept with the item", async ({ page }) => {
  await page.goto("/map");
  await feedbackButton(page).click();
  const drawer = page.getByRole("complementary", { name: "Feedback" });
  await drawer.getByLabel("Feedback text").fill("tagged");
  await drawer.getByLabel("Add tag").fill("layout");
  await drawer.getByLabel("Add tag").press("Enter");
  await drawer.getByLabel("Add tag").fill("map,");
  await drawer.getByRole("button", { name: "Submit feedback" }).click();
  const card = drawer.getByTestId("feedback-card").first();
  await expect(card.locator(".feedback-tag")).toHaveText(["layout", "map"]);
});
