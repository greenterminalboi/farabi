import { expect, type Page, test } from "@playwright/test";
import { resetDb, startConversation } from "./helpers";

test.beforeEach(resetDb);

const feedbackButton = (page: Page) => page.getByRole("button", { name: /^Feedback/ });

async function submitFeedback(page: Page, text: string) {
  const drawer = page.getByRole("complementary", { name: "Feedback" });
  if (!(await drawer.isVisible())) await feedbackButton(page).click();
  await drawer.getByLabel("Feedback text").fill(text);
  await drawer.getByRole("button", { name: "Submit feedback" }).click();
  await expect(drawer.getByTestId("feedback-card").first()).toContainText(text);
}

test("capture from a conversation and from the map without navigating away", async ({ page }) => {
  const nodeId = await startConversation(page);
  const url = page.url();

  // The button is on every view.
  for (const path of ["/", "/map", "/definitions", `/n/${nodeId}`]) {
    await page.goto(path);
    await expect(feedbackButton(page)).toBeVisible();
  }

  await feedbackButton(page).click();
  const drawer = page.getByRole("complementary", { name: "Feedback" });
  await expect(drawer).toBeVisible();
  expect(page.url()).toBe(url);

  // Whitespace-only text cannot be submitted.
  await drawer.getByLabel("Feedback text").fill("   ");
  await expect(drawer.getByRole("button", { name: "Submit feedback" })).toBeDisabled();

  const t0 = Date.now();
  await submitFeedback(page, "chat test");
  expect(Date.now() - t0).toBeLessThan(1000); // SC-002
  expect(page.url()).toBe(url);
  const chatCard = drawer.getByTestId("feedback-card").first();
  await expect(chatCard).toContainText("Open");
  await expect(chatCard.getByRole("link", { name: "open conversation" })).toHaveAttribute("href", `/n/${nodeId}`);

  // Switch to the map with the drawer open; it stays open over the map.
  await page.getByRole("link", { name: "Map" }).click();
  await page.waitForURL(/\/map$/);
  await expect(drawer).toBeVisible();
  await submitFeedback(page, "map test");
  const mapCard = drawer.getByTestId("feedback-card").first();
  await expect(mapCard.locator(".feedback-meta")).toContainText("Map");
  await expect(mapCard.getByRole("link")).toHaveCount(0);

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
