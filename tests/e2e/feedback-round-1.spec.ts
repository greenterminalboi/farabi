import { expect, test } from "@playwright/test";
import { branchOn, openMap, resetDb, selectInLastAiMessage, send, setAiMode, startConversation } from "./helpers";

// Fixes from the first round of in-app feedback (feedback/FEEDBACK.md, 2026-09-27).

test.beforeEach(resetDb);

test("Shift+Enter grows the message box instead of scrolling it", async ({ page }) => {
  await startConversation(page);
  const box = page.getByLabel("Message");
  const start = (await box.boundingBox())!.height;
  await box.click();
  for (const line of ["one", "two", "three", "four"]) {
    await page.keyboard.type(line);
    await page.keyboard.press("Shift+Enter");
  }
  await expect.poll(async () => (await box.boundingBox())!.height).toBeGreaterThan(start + 40);
  expect(await box.evaluate((el) => el.scrollTop)).toBe(0);
});

test("a reply renders Markdown while it streams", async ({ page }) => {
  await startConversation(page);
  await setAiMode(page, "ok", undefined, 400);
  await page.getByLabel("Message").fill("make this **bold** please");
  await page.getByLabel("Message").press("Enter");
  await expect(page.getByTestId("streaming").locator("strong")).toHaveText("bold");
  await setAiMode(page, "ok");
});

test("your messages are bubbles that fit their text; AI replies have no bubble", async ({ page }) => {
  await startConversation(page);
  await send(page, "Hi");
  const user = page.locator('[data-role="user"]').last();
  const ai = page.locator('[data-role="ai"]').last();
  const list = (await page.getByTestId("message-list").boundingBox())!;
  expect((await user.boundingBox())!.width).toBeLessThan(list.width / 3);
  expect(await ai.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  await expect(ai.locator(".ai-tag")).toBeVisible(); // AI text stays labelled (Article I)
});

test("highlighting shows the toolbar with Define and Branch; context sits above the anchor", async ({ page }) => {
  await startConversation(page);
  await send(page, "Tell me about Pods");
  await selectInLastAiMessage(page, "Containers");
  const toolbar = page.getByRole("toolbar", { name: "Highlight actions" });
  await expect(toolbar.getByRole("button")).toHaveText([/Define/, /Branch/]);
  // Above the selection.
  const sel = await page.evaluate(() => document.getSelection()!.getRangeAt(0).getBoundingClientRect().top);
  expect((await toolbar.boundingBox())!.y + (await toolbar.boundingBox())!.height).toBeLessThanOrEqual(sel);

  await send(page, "And Services?");
  await branchOn(page, "Containers");
  await expect(page.getByTestId("inherited-context")).toBeVisible();
  await expect(page.getByTestId("anchor-quote")).toBeVisible();
  const order = await page.evaluate(() => {
    const ctx = document.querySelector('[data-testid="inherited-context"]')!;
    const quote = document.querySelector('[data-testid="anchor-quote"]')!;
    return ctx.compareDocumentPosition(quote) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  expect(order).toBeTruthy();
});

test("holding a hover for 2 s locks the definition card until a click elsewhere", async ({ page }) => {
  await startConversation(page);
  await send(page, "Tell me about Pods");
  await selectInLastAiMessage(page, "Containers");
  await page.getByRole("toolbar", { name: "Highlight actions" }).getByRole("button", { name: "Define" }).click();
  const mark = page.locator('[data-role="ai"] .term-mark').first();
  await expect(mark).toBeVisible();

  // A short hover does not lock.
  await mark.hover();
  const card = page.getByTestId("term-card");
  await expect(card).toBeVisible();
  await page.mouse.move(5, 5);
  await expect(card).toBeHidden();

  // A long hover does.
  await mark.hover();
  await expect(card).toHaveAttribute("data-locked", "true", { timeout: 3000 });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  await expect(card).toBeVisible();
  await card.click({ position: { x: 10, y: 10 } }); // clicking the card keeps it
  await expect(card).toBeVisible();
  await page.getByTestId("message-list").click({ position: { x: 5, y: 5 } });
  await expect(card).toBeHidden();
});

test("a deep conversation is drawn as a stack on the map", async ({ page }) => {
  await startConversation(page);
  for (let i = 0; i < 4; i++) await send(page, `Question ${i}`);
  await openMap(page, 1);
  await expect.poll(() => page.evaluate(() => window.__farabiMapDebug!.nodes[0].stack)).toBe(1);
});
