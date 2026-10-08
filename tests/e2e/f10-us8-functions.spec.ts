import { expect, type Page, test } from "@playwright/test";
import { cameraState, elementsOf, focusElement, openCanvas, resetDb, setAiMode, startTree } from "./helpers";

// Story 8: run a function on a node (quickstart §3.7; FR-043–FR-054; SC-013).

test.beforeEach(async ({ page }) => {
  await resetDb();
  await setAiMode(page, "ok");
});

const outputs = (page: Page) => page.locator(".element-text.output");

async function runAnalogy(page: Page, answerId: string) {
  await focusElement(page, answerId);
  await page.locator(`[data-node-id="${answerId}"]`).getByRole("button", { name: "ƒ" }).click();
  const menu = page.getByTestId("function-menu");
  await expect(menu).toBeVisible();
  await menu.getByTestId("function-item-analogy").click();
  await expect(menu).toBeHidden();
}

test("the menu lists what accepts the element, and a run adds an AI-suggested edge and output (scenarios 1–2)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Pods");
  const [answer] = await elementsOf(page, "answer");
  await focusElement(page, answer.id);
  const camera = await cameraState(page);
  await page.locator(`[data-node-id="${answer.id}"]`).getByRole("button", { name: "ƒ" }).click();
  await expect(page.getByTestId("function-menu").getByRole("menuitem")).toHaveText(["Analogy", "Premortem", "Steelman", "SCQA"]);
  await page.getByTestId("function-item-analogy").click();
  await expect(outputs(page)).toHaveCount(1);
  const output = outputs(page).first();
  await expect(output.locator(".ai-tag")).toHaveText("AI");
  await expect(output).toContainText("proposed");
  await expect(output.locator(".element-body")).toContainText(/Fake analogy #\d+/);
  // The function edge is drawn as a labelled connector chip.
  await expect(page.locator(".element-text.function_connector")).toContainText("Analogy →");
  // Its arrival didn't move the camera (FR-025).
  expect((await cameraState(page)).moves).toBe(camera.moves);
  // Outputs are leaves: no composer, no Branch.
  const [out] = await elementsOf(page, "output");
  await focusElement(page, out.id);
  await expect(page.getByTestId("composer")).toHaveCount(0);
});

test("confirm, reject (hidden by default), and run again adds a sibling (scenarios 3–4)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Pods");
  const [answer] = await elementsOf(page, "answer");
  await runAnalogy(page, answer.id);
  await expect(outputs(page)).toHaveCount(1);
  const first = outputs(page).first();
  await first.getByRole("button", { name: "Run again" }).click();
  await expect(outputs(page)).toHaveCount(2);
  // Confirm one; it says so and keeps its text.
  await first.getByRole("button", { name: "Confirm" }).click();
  await expect(first).toContainText("confirmed");
  // Reject the other: hidden, unless "Show rejected" is on.
  const second = outputs(page).filter({ hasNotText: "confirmed" });
  await second.getByRole("button", { name: "Reject" }).click();
  await expect(outputs(page)).toHaveCount(1);
  await page.getByLabel("Show rejected").check();
  await expect(outputs(page)).toHaveCount(2);
  await expect(outputs(page).filter({ hasText: "rejected" })).toHaveCount(1);
  await page.getByLabel("Show rejected").uncheck();
  await expect(outputs(page)).toHaveCount(1);
});

test("a failed run creates nothing and offers Retry (FR-052)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Pods");
  const [answer] = await elementsOf(page, "answer");
  await setAiMode(page, "fail");
  await focusElement(page, answer.id);
  await page.locator(`[data-node-id="${answer.id}"]`).getByRole("button", { name: "ƒ" }).click();
  await page.getByTestId("function-item-analogy").click();
  await expect(page.getByTestId("function-error")).toBeVisible();
  await expect(outputs(page)).toHaveCount(0);
  await setAiMode(page, "ok");
  await page.getByTestId("function-retry").click();
  await expect(outputs(page)).toHaveCount(1);
});

test("settings are saved without running anything, per kind and per edge (scenario 5, FR-053)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Pods");
  const [answer] = await elementsOf(page, "answer");
  await runAnalogy(page, answer.id);
  await expect(outputs(page)).toHaveCount(1);
  // Per edge: the chip's settings.
  await page.locator(".element-text.function_connector").getByRole("button", { name: "⚙" }).click();
  const panel = page.getByTestId("edge-settings");
  await panel.getByTestId("edge-setting-length").selectOption("paragraph");
  await expect(panel.getByTestId("edge-setting-length")).toHaveValue("paragraph");
  await page.keyboard.press("Escape");
  await expect(outputs(page)).toHaveCount(1);
  // Per kind, on the settings page.
  await page.goto("/settings");
  await page.getByTestId("kind-setting-analogy-reach").selectOption("far");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await openCanvas(page);
  await expect(outputs(page)).toHaveCount(1);
});
