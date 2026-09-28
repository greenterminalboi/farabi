import { expect, test, type Locator, type Page } from "@playwright/test";
import { branchOn, resetDb, send, setAiMode, startConversation, waitForReplyEnd } from "./helpers";

// Feature 007: chat bubble and composer visual refresh (contracts/ui.md).

test.beforeEach(resetDb);

const WIDTHS = [1440, 1024, 700];
const HEIGHT = 900;

/** The message list's content box, excluding its padding and any scrollbar. */
async function listContent(page: Page) {
  return page.getByTestId("message-list").evaluate((el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      left: r.left + parseFloat(cs.paddingLeft),
      right: r.right - parseFloat(cs.paddingRight) - (el.offsetWidth - el.clientWidth),
    };
  });
}

/** The chat zooms in on navigation (220 ms); measure only once it has settled. */
async function settle(page: Page) {
  await page.locator("section.chat").evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

async function style(locator: Locator, prop: string, pseudo?: string) {
  return locator.evaluate(
    (el, [prop, pseudo]) => getComputedStyle(el, pseudo || null).getPropertyValue(prop),
    [prop, pseudo ?? ""] as const,
  );
}

async function box(locator: Locator) {
  const b = (await locator.boundingBox())!;
  return { ...b, right: b.x + b.width, bottom: b.y + b.height };
}

function expectInside(inner: Awaited<ReturnType<typeof box>>, outer: Awaited<ReturnType<typeof box>>) {
  expect(inner.x).toBeGreaterThanOrEqual(outer.x - 1);
  expect(inner.y).toBeGreaterThanOrEqual(outer.y - 1);
  expect(inner.right).toBeLessThanOrEqual(outer.right + 1);
  expect(inner.bottom).toBeLessThanOrEqual(outer.bottom + 1);
}

test("user messages are right-aligned content-sized bubbles; AI replies stay plain and tagged", async ({ page }) => {
  await page.setViewportSize({ width: WIDTHS[0], height: HEIGHT });
  await startConversation(page);
  await settle(page);
  await send(page, "Hi");
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: HEIGHT });
    const content = await listContent(page);
    const user = page.locator('[data-role="user"]').last();
    const ai = page.locator('[data-role="ai"]').last();
    const u = await box(user);
    const a = await box(ai);

    expect(Math.abs(u.right - content.right), `user bubble right edge at ${width}px`).toBeLessThanOrEqual(1);
    expect(u.width).toBeLessThan((content.right - content.left) / 3);
    expect(await style(user, "background-color")).not.toBe("rgba(0, 0, 0, 0)");
    expect(parseFloat(await style(user, "border-top-left-radius"))).toBeGreaterThanOrEqual(12);

    expect(Math.abs(a.x - content.left), `AI text left edge at ${width}px`).toBeLessThanOrEqual(1);
    expect(await style(ai, "background-color")).toBe("rgba(0, 0, 0, 0)");
    await expect(ai.locator(".ai-tag")).toHaveText("AI");

    for (const b of [u, a]) {
      expect(b.x).toBeGreaterThanOrEqual(content.left - 1);
      expect(b.right).toBeLessThanOrEqual(content.right + 1);
    }
  }
});

test("a long user message wraps inside a capped bubble", async ({ page }) => {
  await page.setViewportSize({ width: WIDTHS[0], height: HEIGHT });
  await startConversation(page);
  await settle(page);
  await send(page, "Hi");
  const short = await box(page.locator('[data-role="user"]').last());

  await send(page, `${"words and more words ".repeat(40)}${"x".repeat(200)}`);
  const content = await listContent(page);
  const long = page.locator('[data-role="user"]').last();
  const l = await box(long);
  expect(Math.abs(l.right - content.right)).toBeLessThanOrEqual(1);
  expect(l.width).toBeLessThanOrEqual(Math.min(0.8 * (content.right - content.left), 640) + 1);
  expect(l.height).toBeGreaterThan(2 * short.height);
  expect(await long.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

  await send(page, "👍");
  const emoji = await box(page.locator('[data-role="user"]').last());
  expect(emoji.width).toBeGreaterThanOrEqual(emoji.height - 1);
});

test("composer is one rounded box with an icon-only Send inside it", async ({ page }) => {
  await page.setViewportSize({ width: WIDTHS[0], height: HEIGHT });
  await startConversation(page);
  await settle(page);
  const form = page.locator("form.composer");
  const textarea = page.getByLabel("Message");
  const sendBtn = page.getByRole("button", { name: "Send" });

  expect((await sendBtn.innerText()).trim()).toBe("");
  await expect(sendBtn.locator("svg")).toHaveCount(1);
  expectInside(await box(sendBtn), await box(form));

  expect(parseFloat(await style(form, "border-top-left-radius"))).toBeGreaterThanOrEqual(16);
  expect(await style(form, "background-color")).not.toBe("rgba(0, 0, 0, 0)");
  expect(await style(textarea, "border-top-width")).toBe("0px");
  expect(await style(textarea, "background-color")).toBe("rgba(0, 0, 0, 0)");

  await expect(textarea).toHaveAttribute("placeholder", "Write a message…");
  expect(await style(textarea, "color", "::placeholder")).not.toBe(await style(textarea, "color"));

  await expect(sendBtn).toBeDisabled();
  await textarea.fill("hello");
  await expect(sendBtn).toBeEnabled();

  const before = await page.getByTestId("message").count();
  await sendBtn.click();
  await expect(page.getByTestId("message")).toHaveCount(before + 2);
  await waitForReplyEnd(page);
});

test("Stop replaces Send in place while a reply streams", async ({ page }) => {
  await page.setViewportSize({ width: WIDTHS[0], height: HEIGHT });
  await startConversation(page);
  await settle(page);
  await setAiMode(page, "ok", 0, 400);
  await page.getByLabel("Message").fill("a long answer please");
  await page.getByLabel("Message").press("Enter");

  const stop = page.getByRole("button", { name: "Stop" });
  await expect(stop).toBeVisible();
  expect((await stop.innerText()).trim()).toBe("");
  await expect(stop.locator("svg")).toHaveCount(1);
  expectInside(await box(stop), await box(page.locator("form.composer")));

  await stop.click();
  await expect(page.getByTestId("ended-early")).toContainText("Stopped");
  await setAiMode(page, "ok");
});

test("composer still grows, then scrolls, at about half the screen", async ({ page }) => {
  await page.setViewportSize({ width: WIDTHS[0], height: HEIGHT });
  await startConversation(page);
  await settle(page);
  const textarea = page.getByLabel("Message");
  const start = (await textarea.boundingBox())!.height;
  await textarea.click();
  for (const line of ["one", "two", "three", "four"]) {
    await page.keyboard.type(line);
    await page.keyboard.press("Shift+Enter");
  }
  await expect.poll(async () => (await textarea.boundingBox())!.height).toBeGreaterThan(start + 40);

  await textarea.fill(Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n"));
  await expect(textarea).toHaveClass(/overflowing/);
  expect((await textarea.boundingBox())!.height).toBeLessThanOrEqual(0.45 * HEIGHT + 2);
});

test("chat rows share one centered column at every width", async ({ page }) => {
  await page.setViewportSize({ width: WIDTHS[0], height: HEIGHT });
  await startConversation(page);
  await settle(page);
  await send(page, "Tell me about Pods");
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: HEIGHT });
    const main = await box(page.locator(".main"));
    const chat = await box(page.locator("section.chat"));
    // Centered in the space left of the branch panel (Feature 8).
    const right = (await box(page.getByTestId("branch-panel"))).x;
    expect(chat.width).toBeLessThanOrEqual(820);
    expect(Math.abs(chat.x - main.x - (right - chat.right)), `centered at ${width}px`).toBeLessThanOrEqual(1);

    const content = await listContent(page);
    const composer = await box(page.locator("form.composer"));
    expect(Math.abs(composer.x - content.left), `composer left at ${width}px`).toBeLessThanOrEqual(1);
    expect(Math.abs(composer.right - content.right), `composer right at ${width}px`).toBeLessThanOrEqual(1);

    const header = page.locator(".node-header");
    const headerLeft = (await box(header)).x + parseFloat(await style(header, "padding-left"));
    expect(Math.abs(headerLeft - content.left), `header left at ${width}px`).toBeLessThanOrEqual(1);
  }

  await page.setViewportSize({ width: WIDTHS[0], height: HEIGHT });
  await branchOn(page, "Containers");
  await settle(page);
  const content = await listContent(page);
  const quote = await box(page.getByTestId("anchor-quote"));
  expect(quote.x).toBeGreaterThanOrEqual(content.left - 1);
  expect(quote.right).toBeLessThanOrEqual(content.right + 1);
});
