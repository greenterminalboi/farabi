import { expect, test, type Page } from "@playwright/test";
import {
  confirmQuestion,
  resetDb,
  selectInLastAiMessage,
  send,
  setAiMode,
  startConversation,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetDb();
  await setAiMode(page, "ok"); // the fake is shared by every test in this server
});

const PHRASE = "Containers are mentioned here.";
const lastAi = (page: Page) => page.locator('[data-role="ai"][data-message-id]').last();
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Highlight actions" });
const selectionText = (page: Page) => page.evaluate(() => document.getSelection()?.toString() ?? "");

/** Clicks the rendered word `word` inside the last AI message. */
async function clickWord(page: Page, word: string) {
  await lastAi(page).locator("span[data-start]", { hasText: word }).first().click({ position: { x: 3, y: 5 } });
}

test("bold text in a completed reply is underlined and hands off to the toolbar (US1)", async ({ page }) => {
  await startConversation(page);
  await send(page, "Pods");
  const marks = lastAi(page).locator(".suggest-mark");
  await expect(marks.first()).toBeVisible();
  await expect(lastAi(page).locator(".suggest-mark")).toHaveText([PHRASE]);
  // Only the bold sentence, never the plain one, and never the user's own message (FR-007).
  await expect(page.locator('[data-role="user"] .suggest-mark')).toHaveCount(0);

  await clickWord(page, "mentioned");
  await expect(toolbar(page)).toBeVisible();
  expect(await selectionText(page)).toBe(PHRASE);

  const parentUrl = page.url();
  await toolbar(page).getByRole("button", { name: "Branch" }).click();
  await confirmQuestion(page);
  await page.waitForURL((url) => url.toString() !== parentUrl);
  const childId = page.url().split("/n/")[1];
  const child = await (await page.request.get(`/api/nodes/${childId}`)).json();
  expect(child.anchor.text).toBe(PHRASE);
});

test("no suggestions while streaming or on replies that ended early (FR-003)", async ({ page }) => {
  await startConversation(page);
  await setAiMode(page, "ok", undefined, 400);
  await page.getByLabel("Message").fill("slow one");
  await page.getByLabel("Message").press("Enter");
  await expect(page.getByTestId("streaming")).toBeVisible();
  await expect(page.locator(".suggest-mark")).toHaveCount(0);
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByTestId("ended-early")).toBeVisible();

  await setAiMode(page, "stall");
  await page.getByLabel("Message").fill("interrupt me");
  await page.getByLabel("Message").press("Enter");
  await expect(page.getByTestId("ended-early")).toHaveCount(2);
  await page.waitForTimeout(1500);
  await expect(page.locator(".suggest-mark")).toHaveCount(0);
});

test.use({ deviceScaleFactor: 2 });

test("suggestions coexist with terms and branch markers (US2)", async ({ page }) => {
  await startConversation(page);
  await send(page, "Pods");
  await selectInLastAiMessage(page, "Containers");
  await toolbar(page).getByRole("button", { name: "Define" }).click();
  await expect(page.getByTestId("definitions-notice")).toBeVisible();
  await page.evaluate(() => document.getSelection()?.removeAllRanges());

  const term = lastAi(page).locator(".term-mark.suggest-mark");
  await expect(term).toHaveText("Containers");
  await term.hover();
  await expect(page.getByTestId("term-card")).toBeVisible();
  // Clicking the term keeps the term's own behavior; it doesn't select the suggestion.
  await term.click();
  expect(await selectionText(page)).toBe("");
  await page.mouse.move(0, 0);

  // Clicking elsewhere in the suggestion selects all of it.
  await clickWord(page, "mentioned");
  expect(await selectionText(page)).toBe(PHRASE);
  await expect(toolbar(page)).toBeVisible();

  await page.evaluate(() => document.getSelection()?.removeAllRanges());
  await lastAi(page).screenshot({ path: test.info().outputPath("f5-term-and-suggestion.png") });
  await clickWord(page, "mentioned");

  // Branch from it; afterwards the same text is a marker too, and clicking opens the branch.
  const parentUrl = page.url();
  await toolbar(page).getByRole("button", { name: "Branch" }).click();
  await confirmQuestion(page);
  await page.waitForURL((url) => url.toString() !== parentUrl);
  const childUrl = page.url();
  await page.goto(parentUrl);
  const both = lastAi(page).locator(".marker.suggest-mark", { hasText: "mentioned" });
  await expect(both).toHaveCount(1);
  // SC-003 evidence: marker, term and suggestion side by side, kept with the test output.
  await lastAi(page).screenshot({ path: test.info().outputPath("f5-three-underlines.png") });
  await both.click();
  await page.waitForURL(childUrl);
});

test("the Suggestions toggle hides them (FR-012)", async ({ page }) => {
  await startConversation(page);
  await send(page, "Pods");
  await expect(lastAi(page).locator(".suggest-mark").first()).toBeVisible();

  const toggle = page.getByTestId("suggestions-toggle");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".suggest-mark")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("suggestions-toggle")).toHaveAttribute("aria-pressed", "false");
  await send(page, "Deployments");
  await expect(page.locator(".suggest-mark")).toHaveCount(0);

  await page.getByTestId("suggestions-toggle").click();
  await expect(lastAi(page).locator(".suggest-mark").first()).toBeVisible();
});

test("underlines need no AI: no request, and they show even when the AI is unavailable", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/suggestions")) requests.push(r.url());
  });
  await startConversation(page);
  await send(page, "Pods");
  await setAiMode(page, "fail");
  await page.reload();
  await expect(lastAi(page).locator(".suggest-mark")).toHaveText([PHRASE]);
  await expect(page.locator(".composer-error")).toHaveCount(0);
  expect(requests).toEqual([]);
});
