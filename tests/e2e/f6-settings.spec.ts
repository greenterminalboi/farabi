import { expect, test, type Page } from "@playwright/test";
import { ask, openCanvas, resetDb, setAiMode, startTree } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetDb();
  await setAiMode(page, "ok");
});

const slider = (page: Page) => page.getByTestId("pressure-slider");
const readout = (page: Page) => page.getByTestId("pressure-readout");

async function openSettings(page: Page) {
  await page.getByRole("link", { name: "Settings" }).click();
  await page.waitForURL(/\/settings$/);
  await expect(readout(page)).toBeVisible();
}

test("defaults, then the level and model shape and label new replies (US1, US3, US4)", async ({ page }) => {
  await page.goto("/");
  await openSettings(page);
  await expect(readout(page)).toHaveText("Level 8 · Detailed");
  await expect(page.locator('.pressure-band[aria-current="true"]')).toHaveText("Detailed");
  await expect(page.getByTestId("model-select")).toHaveValue("default");

  await slider(page).focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowLeft");
  await expect(readout(page)).toHaveText("Level 2 · Brief");
  await expect(page.getByRole("status")).toHaveText("Saved");

  await openCanvas(page);
  await startTree(page, "Pods");
  await expect(page.getByTestId("reply-meta").last()).toHaveText("Brief · 2 · Default model");

  await openSettings(page);
  await expect(readout(page)).toHaveText("Level 2 · Brief");
  await page.getByTestId("model-select").selectOption("claude-sonnet-5");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await openCanvas(page);
  await ask(page, "More");
  const labels = page.getByTestId("reply-meta");
  await expect(labels).toHaveText(["Brief · 2 · Default model", "Brief · 2 · Claude Sonnet 5"]);
});

test("a failed save keeps the level in effect and says so", async ({ page }) => {
  await page.goto("/settings");
  await expect(readout(page)).toHaveText("Level 8 · Detailed");
  await page.route("**/api/settings", (route) =>
    route.request().method() === "PUT" ? route.fulfill({ status: 500, body: "{}" }) : route.continue(),
  );
  await slider(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("alert").filter({ hasText: "Couldn't save" })).toBeVisible();
  await expect(readout(page)).toHaveText("Level 8 · Detailed");
  await expect(slider(page)).toHaveValue("8");
});

test("Settings is reachable from every view (SC-006)", async ({ page }) => {
  await openCanvas(page);
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  await page.getByRole("link", { name: "Definitions", exact: true }).click();
  await page.waitForURL(/\/definitions$/);
  await openSettings(page);
});
