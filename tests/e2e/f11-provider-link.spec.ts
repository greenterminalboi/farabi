import { expect, type Page, test } from "@playwright/test";
import { ask, elementsOf, focusElement, openCanvas, resetDb, setAiMode } from "./helpers";

// Feature 11 FR-014 hand-off: when an AI action is refused because the provider can't run yet
// (422 provider_not_ready), the composer and the function menu link to Settings. The refusal is
// stubbed at the network layer; the server side is covered by tests/integration/f11-provider-ready.

test.beforeEach(async ({ page }) => {
  await resetDb();
  await setAiMode(page, "ok");
});

const MESSAGE = "Add your Claude API key in Settings to use the Claude API.";

async function refuse(page: Page, pattern: string) {
  await page.route(pattern, (route) =>
    route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "provider_not_ready", message: MESSAGE },
        provider: "claude",
        reason: "no_api_key",
        settingsPath: "/settings#provider",
      }),
    }),
  );
}

test("the composer links a provider_not_ready refusal to Settings, and other errors don't get the link", async ({ page }) => {
  await openCanvas(page);
  await ask(page, "First");
  const composer = page.getByTestId("composer");
  const box = composer.getByLabel("Message");

  // A plain network failure: Retry only.
  await page.route("**/api/nodes/*/ask", (route) => route.abort());
  await box.fill("Keep me");
  await box.press("Enter");
  await expect(composer.getByRole("alert")).toBeVisible();
  await expect(composer.getByTestId("provider-settings-link")).toHaveCount(0);
  await page.unroute("**/api/nodes/*/ask");

  await refuse(page, "**/api/nodes/*/ask");
  await composer.getByRole("button", { name: "Retry" }).click();
  await expect(composer.getByRole("alert")).toContainText(MESSAGE);
  const link = composer.getByTestId("provider-settings-link");
  await expect(link).toHaveAttribute("href", "/settings#provider");
  await expect(box).toHaveValue("Keep me");
  await link.click();
  await expect(page).toHaveURL(/\/settings#provider$/);
  await expect(page.locator("#provider")).toBeVisible();
});

test("the function menu links a provider_not_ready refusal to Settings", async ({ page }) => {
  await openCanvas(page);
  await ask(page, "Pods");
  const [answer] = await elementsOf(page, "answer");
  await refuse(page, "**/api/nodes/*/functions/*/run");
  await focusElement(page, answer.id);
  await page.locator(`[data-node-id="${answer.id}"]`).getByRole("button", { name: "ƒ" }).click();
  await page.getByTestId("function-item-analogy").click();
  const error = page.getByTestId("function-error");
  await expect(error).toContainText(MESSAGE);
  await expect(error.getByTestId("provider-settings-link")).toHaveAttribute("href", "/settings#provider");
  await expect(error.getByTestId("function-retry")).toBeVisible();
});
