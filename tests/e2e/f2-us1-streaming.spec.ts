import { expect, test } from "@playwright/test";
import { resetDb, setAiMode, startConversation, waitForReplyEnd } from "./helpers";

test.beforeEach(resetDb);
test.afterEach(async ({ page }) => setAiMode(page, "ok"));

test("a reply streams in before it finishes", async ({ page }) => {
  await startConversation(page);
  await setAiMode(page, "slow", 0); // normal chunked streaming
  await page.getByLabel("Message").fill("Explain Pods in detail");
  await page.getByLabel("Message").press("Enter");
  // Part of the reply is visible while it is still streaming.
  await expect(page.getByTestId("streaming")).toBeVisible();
  const partial = await page.getByTestId("streaming").innerText();
  await waitForReplyEnd(page);
  const final = await page.locator('[data-role="ai"]').last().innerText();
  expect(final.length).toBeGreaterThan(partial.length);
  expect(final).toContain("Containers are mentioned here");
});

test("Stop keeps the partial reply, marked stopped", async ({ page }) => {
  await startConversation(page);
  await setAiMode(page, "ok", 0, 400); // ~2 s of streaming, time to press Stop
  await page.getByLabel("Message").fill("A long answer please");
  await page.getByLabel("Message").press("Enter");
  await expect(page.getByTestId("streaming")).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByTestId("ended-early")).toContainText("Stopped");
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("an interrupted reply stays, marked incomplete, across reloads", async ({ page }) => {
  await startConversation(page);
  await setAiMode(page, "stall");
  await page.getByLabel("Message").fill("interrupt me");
  await page.getByLabel("Message").press("Enter");
  await expect(page.getByTestId("ended-early")).toContainText("Incomplete");
  await page.reload();
  await expect(page.getByTestId("ended-early")).toContainText("Incomplete");
  await expect(page.locator('[data-role="ai"]').last()).toContainText("Echo");
});

test("a reply keeps going while the user is on the map", async ({ page }) => {
  const nodeId = await startConversation(page);
  await setAiMode(page, "slow", 1500);
  await page.getByLabel("Message").fill("finish without me");
  await page.getByLabel("Message").press("Enter");
  await page.getByRole("link", { name: "Map" }).click();
  await page.waitForURL(/\/map$/);
  await page.waitForTimeout(2500);
  await page.goto(`/n/${nodeId}`);
  await waitForReplyEnd(page);
  await expect(page.locator('[data-role="ai"]').last()).toContainText("finish without me");
});
