import { expect, test } from "@playwright/test";
import { branchOn, openMap, resetDb, send, setAiMode, startConversation } from "./helpers";

test.beforeEach(resetDb);
test.afterEach(async ({ page }) => setAiMode(page, "ok"));

test("regenerate replaces the latest reply until it has a branch", async ({ page }) => {
  const root = await startConversation(page);
  await send(page, "Explain Pods");
  const regenerate = page.getByRole("button", { name: "Regenerate" });
  await expect(regenerate).toHaveCount(1);
  const aiMessage = page.locator('[data-role="ai"][data-message-id]').last();
  const oldId = await aiMessage.getAttribute("data-message-id");
  await regenerate.click();
  await expect(aiMessage).not.toHaveAttribute("data-message-id", oldId!);
  await expect(page.getByTestId("message")).toHaveCount(2);

  await branchOn(page, "Containers");
  await page.goto(`/n/${root}`);
  await expect(page.getByRole("button", { name: "Regenerate" })).toHaveCount(0);
});

test("AI outage keeps the message, offers retry, and browsing still works", async ({ page }) => {
  const root = await startConversation(page);
  await send(page, "hello");
  await setAiMode(page, "fail");

  await page.getByLabel("Message").fill("are you there?");
  await page.getByLabel("Message").press("Enter");
  await expect(page.locator(".composer-error")).toContainText("AI service unavailable");
  await expect(page.locator(".message.failed")).toHaveCount(1);
  await expect(page.locator('[data-role="user"]').last()).toContainText("are you there");

  await openMap(page, 1);
  await page.goto(`/n/${root}`);
  await setAiMode(page, "ok");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.locator(".message.failed")).toHaveCount(0);
  await expect(page.locator('[data-role="ai"]').last()).toContainText("are you there");
});
