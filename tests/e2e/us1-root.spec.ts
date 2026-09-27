import { expect, test } from "@playwright/test";
import { resetDb, send, startConversation } from "./helpers";

test.beforeEach(resetDb);

test("start root conversations that persist", async ({ page }) => {
  const first = await startConversation(page);
  await send(page, "Tell me about Kubernetes Pods");
  const reply = page.locator('[data-role="ai"]').last();
  await expect(reply).toContainText("Containers are mentioned here");
  await expect(reply.locator(".ai-tag")).toHaveText("AI");

  await page.getByRole("button", { name: "New conversation" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith(first));
  const second = page.url().split("/n/")[1];
  await expect(page.getByTestId("message")).toHaveCount(0);

  await page.goto(`/n/${first}`);
  await expect(page.getByTestId("message")).toHaveCount(2);
  await page.reload();
  await expect(page.getByTestId("message")).toHaveCount(2);
  await page.goto(`/n/${second}`);
  await expect(page.getByTestId("node-header")).toContainText("New conversation");
});
