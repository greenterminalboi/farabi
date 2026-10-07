import { expect, type Page, test } from "@playwright/test";
import { ask, canvasDebug, elementsOf, focusElement, openCanvas, resetDb, selectInElement, setAiMode, startTree, textStats } from "./helpers";

// Story 2: read and select text at any zoom (quickstart §3.2; SC-004, SC-006, SC-007, FR-029–FR-035).

test.beforeEach(async ({ page }) => {
  await resetDb();
  await setAiMode(page, "ok");
});

const setCamera = (page: Page, x: number, y: number, scale: number) =>
  page.evaluate(([x, y, s]) => window.__farabiSetCamera!(x, y, s), [x, y, scale] as const);

const idle = (page: Page) => page.waitForTimeout(300);

const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Highlight actions" });

/** Selects the first few mounted characters of an element, wherever the camera is. */
async function selectStart(page: Page, id: string, chars = 4) {
  return page.evaluate(
    ({ id, chars }) => {
      const span = document.querySelector<HTMLElement>(`[data-node-id="${id}"] .element-body span[data-start]`);
      const text = span?.firstChild as Text | null;
      if (!span || !text) return null;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, Math.min(chars, text.data.length));
      const sel = document.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      return range.toString();
    },
    { id, chars },
  );
}

test("selecting text opens the toolbar at every zoom from 0.02 to 4 (scenario 1, SC-004)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Explain pods in detail");
  const [answer] = await elementsOf(page, "answer");
  for (const scale of [0.02, 0.1, 0.35, 1, 2, 4]) {
    await setCamera(page, answer.x + 40, answer.y + 40, scale);
    await idle(page);
    await expect(page.locator(`[data-node-id="${answer.id}"] .element-body span[data-start]`).first()).toBeAttached();
    const picked = await selectStart(page, answer.id);
    expect(picked, `scale ${scale}`).toBeTruthy();
    await expect(toolbar(page), `scale ${scale}`).toBeVisible();
    await page.evaluate(() => document.getSelection()!.removeAllRanges());
    await expect(toolbar(page)).toHaveCount(0);
  }
});

test("far away text is clipped, zooming in reveals more, and nothing off screen stays mounted (scenario 2, SC-006)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Pods");
  for (let i = 0; i < 6; i++) await ask(page, `More detail on point number ${i} please, with as much text as possible`);
  const answers = await elementsOf(page, "answer");
  const last = answers[answers.length - 1];

  // Very far: everything is in view, each element shows a little real text, cut with a mark.
  await setCamera(page, last.x, last.y, 0.02);
  await idle(page);
  const far = await textStats(page);
  expect(far.mounted).toBeGreaterThan(0);
  const item = page.locator(`[data-node-id="${last.id}"]`);
  const farChars = ((await item.locator(".element-body").textContent()) ?? "").length;

  // Close: the same element shows more, up to its full text.
  await setCamera(page, last.x + 240, last.y + 40, 1.5);
  await idle(page);
  const nearChars = ((await item.locator(".element-body").textContent()) ?? "").length;
  expect(nearChars).toBeGreaterThanOrEqual(farChars);
  // Zoomed in, elements far off screen are unmounted once the camera rests.
  await page.waitForTimeout(250);
  expect((await textStats(page)).offscreenMounted).toBe(0);
});

test("a selection and a composer draft survive panning away and back (scenario 3, SC-007, FR-034)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Pods");
  const [answer] = await elementsOf(page, "answer");
  await page.getByTestId("composer").getByLabel("Message").fill("a draft in progress");
  await selectInElement(page, answer.id, "Containers");
  await expect(toolbar(page)).toBeVisible();

  // Far away, at another zoom: the element stays mounted because it is pinned.
  await setCamera(page, answer.x + 50_000, answer.y + 50_000, 1);
  await idle(page);
  const stats = await textStats(page);
  expect(stats.pinned).toContain(answer.id);
  expect(await page.evaluate(() => document.getSelection()!.toString())).toBe("Containers");

  await setCamera(page, answer.x + 240, answer.y + 50, 1);
  await idle(page);
  await expect(toolbar(page)).toBeVisible();
  await expect(page.getByTestId("composer").getByLabel("Message")).toHaveValue("a draft in progress");
});

test("text and frames never drift apart (scenario 4, FR-029)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Pods");
  await ask(page, "More");
  const [answer] = await elementsOf(page, "answer");
  for (const scale of [0.5, 1, 2.5]) {
    await setCamera(page, answer.x + 100, answer.y + 30, scale);
    await idle(page);
    expect(await page.evaluate(() => window.__farabiCanvasDrift!())).toBeLessThanOrEqual(1);
  }
  // During a glide too: a walk moves the camera over several frames.
  await setCamera(page, answer.x + 240, answer.y + 50, 1);
  await idle(page);
  await focusElement(page, answer.id);
  await page.keyboard.press("Alt+ArrowUp");
  for (let i = 0; i < 5; i++) {
    expect(await page.evaluate(() => window.__farabiCanvasDrift!())).toBeLessThanOrEqual(1);
    await page.waitForTimeout(60);
  }
});

test("markers, terms and suggestions render, and a selection across them still works (scenario 5, FR-035)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Tell me about Pods");
  const [answer] = await elementsOf(page, "answer");
  const item = page.locator(`[data-node-id="${answer.id}"]`);
  // Suggestion: the reply's bold text.
  await expect(item.locator("[data-suggest]").first()).toHaveText("Containers are mentioned here.");
  // A term.
  await selectInElement(page, answer.id, "Pods");
  await toolbar(page).getByRole("button", { name: "Define" }).click();
  await expect(item.locator(".term-mark").first()).toHaveText("Pods");
  // A marker.
  await selectInElement(page, answer.id, "Containers");
  await toolbar(page).getByRole("button", { name: "Branch" }).click();
  await page.getByTestId("branch-question-form").getByLabel("Your question (optional)").press("Enter");
  await expect(item.locator("[data-markers]").first()).toHaveText("Containers");
  // A selection spanning the term, the marker and the suggestion maps to the stored text.
  await selectInElement(page, answer.id, "Pods. Containers are");
  await expect(toolbar(page)).toBeVisible();
  expect((await canvasDebug(page)).elements.filter((e) => e.kind === "question")).toHaveLength(2);
});
