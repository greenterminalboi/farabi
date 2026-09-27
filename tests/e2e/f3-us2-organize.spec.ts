import { expect, type Page, test } from "@playwright/test";
import { resetDb } from "./helpers";

test.beforeEach(resetDb);
// All four cards must be on screen for the pointer drag (OpenDyslexic makes cards taller).
test.use({ viewport: { width: 1280, height: 1100 } });

async function seed(page: Page, text: string, tags: string[] = []) {
  const res = await page.request.post("/api/feedback", {
    multipart: { text, view: "map", tags: JSON.stringify(tags) },
  });
  expect(res.status()).toBe(201);
}

async function openDrawer(page: Page) {
  await page.getByRole("button", { name: /^Feedback/ }).click();
  const drawer = page.getByRole("complementary", { name: "Feedback" });
  await expect(drawer).toBeVisible();
  return drawer;
}

const cardTexts = (page: Page) => page.getByTestId("feedback-card").locator(".feedback-text").allTextContents();

test("drag to reorder persists, filter keeps order, keyboard moves", async ({ page }) => {
  await seed(page, "oldest", ["map"]);
  await seed(page, "middle", ["Map  View"]);
  await seed(page, "newer", ["chat"]);
  await seed(page, "newest");
  await page.goto("/map");
  const drawer = await openDrawer(page);
  await expect.poll(() => cardTexts(page)).toEqual(["newest", "newer", "middle", "oldest"]);

  // Drag the oldest card's handle above the first card.
  const handle = drawer.getByTestId("feedback-card").nth(3).getByRole("button", { name: "Drag to reorder" });
  const first = await drawer.getByTestId("feedback-card").first().boundingBox();
  const from = await handle.boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from!.x + from!.width / 2, from!.y + ((first!.y + 4 - from!.y) * i) / 10);
  }
  await expect(drawer.locator(".feedback-card.drop-before")).toHaveCount(1);
  await page.mouse.up();
  await expect.poll(() => cardTexts(page)).toEqual(["oldest", "newest", "newer", "middle"]);

  // It survives a reload, and the others keep their relative order.
  await page.reload();
  await openDrawer(page);
  await expect.poll(() => cardTexts(page)).toEqual(["oldest", "newest", "newer", "middle"]);
  await expect(drawer.getByTestId("feedback-card").first()).toContainText("moved");

  // Filter by a normalised tag, then clear it: same order.
  await drawer.getByRole("button", { name: /^Map View/ }).click();
  await expect.poll(() => cardTexts(page)).toEqual(["middle"]);
  await drawer.getByRole("button", { name: "All" }).click();
  await expect.poll(() => cardTexts(page)).toEqual(["oldest", "newest", "newer", "middle"]);

  // Alt+↑ on a focused card moves it up one place.
  await drawer.getByTestId("feedback-card").nth(3).focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(() => cardTexts(page)).toEqual(["oldest", "newest", "middle", "newer"]);
  await page.reload();
  await openDrawer(page);
  await expect.poll(() => cardTexts(page)).toEqual(["oldest", "newest", "middle", "newer"]);
});
