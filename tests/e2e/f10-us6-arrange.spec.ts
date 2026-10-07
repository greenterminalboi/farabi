import { expect, type Page, test } from "@playwright/test";
import { ask, canvasDebug, elementsOf, focusElement, framePoint, openCanvas, resetDb, setAiMode, startTree } from "./helpers";

// Story 6: rearrange by hand and keep notes on edges (quickstart §3.5; FR-037–FR-040).

test.beforeEach(async ({ page }) => {
  await resetDb();
  await setAiMode(page, "ok");
});

/** Presses on an element's frame and drags it by (dx, dy) screen pixels. */
async function drag(page: Page, id: string, dx: number, dy: number, alt = false) {
  const pt = await framePoint(page, id);
  if (alt) await page.keyboard.down("Alt");
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.mouse.move(pt.x + dx / 2, pt.y + dy / 2, { steps: 4 });
  await page.mouse.move(pt.x + dx, pt.y + dy, { steps: 4 });
  await page.mouse.up();
  if (alt) await page.keyboard.up("Alt");
}

const positions = async (page: Page) => new Map((await canvasDebug(page)).elements.map((e) => [e.id, { x: e.x, y: e.y }]));

test("dragging a frame moves one element, Alt-drag or the origin moves the tree, and both persist (scenarios 1–2)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Pods");
  await ask(page, "Services");
  await page.evaluate(() => window.__farabiSetCamera!(240, 300, 1));
  await page.waitForTimeout(300);
  const [first] = await elementsOf(page, "answer");
  const before = await positions(page);

  await drag(page, first.id, 120, 40);
  await expect.poll(async () => (await positions(page)).get(first.id)).toEqual({ x: first.x + 120, y: first.y + 40 });
  // Only that element moved; its children keep their computed place.
  const afterOne = await positions(page);
  for (const [id, p] of before) if (id !== first.id) expect(afterOne.get(id)).toEqual(p);

  // Alt-drag on any element moves the whole tree.
  const question = (await elementsOf(page, "question")).find((q) => q.y > first.y)!;
  await drag(page, question.id, -60, 80, true);
  await expect.poll(async () => (await positions(page)).get(question.id)).toEqual({ x: question.x - 60, y: question.y + 80 });
  const afterTree = await positions(page);
  for (const [id, p] of afterOne) expect(afterTree.get(id)).toEqual({ x: p.x - 60, y: p.y + 80 });

  // Reload: both persist.
  await page.waitForTimeout(300);
  await openCanvas(page);
  await expect.poll(async () => (await positions(page)).get(first.id)).toEqual(afterTree.get(first.id));
  expect((await positions(page)).get(question.id)).toEqual(afterTree.get(question.id));
});

test("another tree growing leaves a placed tree and a placed element where they are (scenario 3, SC-009)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Pods");
  const [first] = await elementsOf(page, "answer");
  await page.evaluate(([x, y]) => window.__farabiSetCamera!(x, y, 1), [first.x + 240, first.y + 50] as const);
  await page.waitForTimeout(300);
  await drag(page, first.id, 80, 0);
  await expect.poll(async () => (await positions(page)).get(first.id)?.x).toBe(first.x + 80);
  const placed = await positions(page);
  await startTree(page, "Another tree entirely");
  await ask(page, "and it grows");
  const after = await positions(page);
  for (const [id, p] of placed) expect(after.get(id)).toEqual(p);
});

test("a click focuses, and a drag past 4 px doesn't (scenario 5, FR-037)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Pods");
  await ask(page, "Services");
  const [first, second] = await elementsOf(page, "answer");
  await focusElement(page, second.id);
  await drag(page, first.id, 30, 0);
  const debug = await canvasDebug(page);
  expect(debug.elements.find((e) => e.id === first.id)!.focused).toBe(false);
  expect(debug.elements.find((e) => e.id === second.id)!.focused).toBe(true);
  // A press that moves less than 4 px is still a click.
  await drag(page, first.id, 2, 1);
  await expect.poll(async () => (await canvasDebug(page)).elements.find((e) => e.id === first.id)!.focused).toBe(true);
});

test("an edge note is added, edited and cleared (scenario 4, FR-040)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Pods");
  await ask(page, "Services");
  const edge = (await elementsOf(page, "question")).sort((a, b) => b.y - a.y)[0];
  await focusElement(page, edge.id);
  const chip = page.locator(`[data-node-id="note:${edge.id}"]`).getByRole("button");
  await expect(chip).toHaveText("+ note");
  await chip.click();
  await page.getByTestId("note-editor").getByLabel("Edge note").fill("builds on the pod idea");
  await page.getByTestId("note-editor").getByLabel("Edge note").press("Enter");
  await expect(chip).toHaveText("builds on the pod idea");
  // Edit, then clear (an empty value).
  await chip.click();
  await page.getByTestId("note-editor").getByLabel("Edge note").fill("contrasts");
  await page.getByTestId("note-editor").getByLabel("Edge note").press("Enter");
  await expect(chip).toHaveText("contrasts");
  await openCanvas(page);
  await expect(page.locator(`[data-node-id="note:${edge.id}"]`).getByRole("button")).toHaveText("contrasts");
  await focusElement(page, edge.id);
  await page.locator(`[data-node-id="note:${edge.id}"]`).getByRole("button").click();
  await page.getByTestId("note-editor").getByLabel("Edge note").fill("");
  await page.getByTestId("note-editor").getByLabel("Edge note").press("Enter");
  await expect(page.locator(`[data-node-id="note:${edge.id}"]`).getByRole("button")).toHaveText("+ note");
});
