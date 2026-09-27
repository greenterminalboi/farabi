import { expect, test } from "@playwright/test";
import { resetDb, send, startConversation } from "./helpers";

test.beforeEach(resetDb);

test("chat → map → chat keeps position and draft", async ({ page }) => {
  const nodeId = await startConversation(page);
  for (let i = 0; i < 15; i++) await send(page, `Message number ${i}`);

  const list = page.getByTestId("message-list");
  await list.evaluate((el) => (el.scrollTop = 400));
  await page.waitForTimeout(200);
  const scrollBefore = await list.evaluate((el) => el.scrollTop);
  await page.getByLabel("Message").fill("unsent thought");

  await page.getByRole("link", { name: "Map" }).click();
  await page.waitForURL(/\/map$/);
  await expect.poll(async () => page.evaluate(() => window.__farabiMapDebug?.nodes.length ?? 0)).toBe(1);

  const point = await page.evaluate((id) => window.__farabiMapScreenPoint?.(id), nodeId);
  expect(point).toBeTruthy();
  await page.mouse.click(point!.x, point!.y);
  await page.waitForURL(new RegExp(`/n/${nodeId}$`));

  await expect(page.getByLabel("Message")).toHaveValue("unsent thought");
  await expect.poll(async () => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(scrollBefore - 60);
  expect(await list.evaluate((el) => el.scrollTop)).toBeLessThan(scrollBefore + 60);
});

test("clicking a map node opens its conversation", async ({ page }) => {
  const first = await startConversation(page);
  await send(page, "hello");
  await page.getByRole("button", { name: "New conversation" }).click();
  await page.waitForURL((u) => !u.pathname.endsWith(first));

  await page.getByRole("link", { name: "Map" }).click();
  await expect.poll(async () => page.evaluate(() => window.__farabiMapDebug?.nodes.length ?? 0)).toBe(2);
  const point = await page.evaluate((id) => window.__farabiMapScreenPoint?.(id), first);
  expect(point).toBeTruthy();
  await page.mouse.click(point!.x, point!.y);
  await page.waitForURL(new RegExp(`/n/${first}$`));
  await expect(page.getByTestId("message")).toHaveCount(2);
});
