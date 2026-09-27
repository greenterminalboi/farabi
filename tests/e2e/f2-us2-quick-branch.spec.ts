import { expect, test } from "@playwright/test";
import { resetDb, send, startConversation, waitForReplyEnd } from "./helpers";

test.beforeEach(resetDb);

test("???? branches from the last message and resends it", async ({ page }) => {
  const parent = await startConversation(page);
  await send(page, "What is a sidecar?");

  // Typing ???? is enough; no Send needed (FR-006a).
  await page.getByLabel("Message").pressSequentially("????");
  await page.waitForURL((url) => !url.pathname.endsWith(parent) && /\/n\//.test(url.pathname));
  await expect(page.getByTestId("anchor-quote")).toContainText("What is a sidecar?");
  await expect(page.locator('[data-role="user"]').first()).toContainText("What is a sidecar?");
  await waitForReplyEnd(page);
  await expect(page.locator('[data-role="ai"]').last()).toContainText("Echo: What is a sidecar");
  // The draft box is empty; "????" was never shown or sent.
  await expect(page.getByLabel("Message")).toHaveValue("");

  await page.goto(`/n/${parent}`);
  await expect(page.locator('[data-role="user"] .marker')).toHaveText("What is a sidecar?");
  await expect(page.getByText("????")).toHaveCount(0);

  // A second ???? has nothing new to branch from: it stays in the box until sent, then it's an
  // ordinary message.
  await page.getByLabel("Message").pressSequentially("????");
  await page.waitForTimeout(500);
  expect(page.url()).toContain(parent);
  await expect(page.getByLabel("Message")).toHaveValue("????");
  await page.getByLabel("Message").fill("");
  await send(page, "????");
  expect(page.url()).toContain(parent);
  await expect(page.locator('[data-role="user"]').last()).toHaveText(/\?\?\?\?/);
});
