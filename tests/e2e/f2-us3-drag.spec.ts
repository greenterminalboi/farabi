import { expect, test, type Page } from "@playwright/test";
import { branchOn, mapDebug, openMap, resetDb, send, startConversation } from "./helpers";

test.beforeEach(resetDb);

async function drag(page: Page, nodeId: string, dx: number, dy: number) {
  const p = await page.evaluate((id) => window.__farabiMapScreenPoint!(id), nodeId);
  await page.mouse.move(p!.x, p!.y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(p!.x + (dx * i) / 5, p!.y + (dy * i) / 5);
  await page.mouse.up();
}

const pos = async (page: Page, id: string) => {
  const n = (await mapDebug(page)).nodes.find((x) => x.id === id)!;
  return { x: n.x, y: n.y };
};

test("drag a tree by its root and a single node; both persist", async ({ page }) => {
  const root = await startConversation(page);
  await send(page, "Tell me about Pods");
  const child = await branchOn(page, "Containers");
  await openMap(page, 2);

  // Drag one node: only it moves.
  const rootBefore = await pos(page, root);
  const childBefore = await pos(page, child);
  await drag(page, child, 150, 60);
  const childAfter = await pos(page, child);
  expect(childAfter.x - childBefore.x).toBeGreaterThan(80);
  expect(await pos(page, root)).toEqual(rootBefore);

  // Drag the root: the whole tree moves, keeping the hand-placed node's offset.
  await drag(page, root, -200, 100);
  const rootMoved = await pos(page, root);
  const childMoved = await pos(page, child);
  expect(rootMoved.x - rootBefore.x).toBeLessThan(-100);
  expect(childMoved.x - rootMoved.x).toBeCloseTo(childAfter.x - rootBefore.x, 0);

  // Positions survive a reload, and the line still joins the same nodes.
  await page.waitForTimeout(300); // saves are sent on release
  await page.reload();
  await page.waitForFunction(() => (window.__farabiMapDebug?.nodes.length ?? 0) === 2);
  const reloaded = await mapDebug(page);
  expect(await pos(page, root)).toEqual(rootMoved);
  expect(await pos(page, child)).toEqual(childMoved);
  expect(reloaded.edges.map(({ from, to }) => ({ from, to }))).toEqual([{ from: root, to: child }]);
});

test("a single click selects; a double-click zooms in and opens; Map zooms back out to it", async ({ page }) => {
  const root = await startConversation(page);
  await send(page, "hello");
  await page.getByRole("button", { name: "New conversation" }).click();
  await page.waitForURL((u) => !u.pathname.endsWith(root));
  await openMap(page, 2);

  const p = await page.evaluate((id) => window.__farabiMapScreenPoint!(id), root);
  // A single click (even with a tiny wobble) only selects the node.
  await page.mouse.move(p!.x, p!.y);
  await page.mouse.down();
  await page.mouse.move(p!.x + 2, p!.y + 1);
  await page.mouse.up();
  await page.waitForTimeout(600);
  await expect(page).toHaveURL(/\/map$/);

  // A double-click opens it.
  await page.mouse.dblclick(p!.x, p!.y);
  await page.waitForURL(new RegExp(`/n/${root}$`));

  // Back to the map: it settles centred on the node we just left.
  await page.getByRole("link", { name: "Map" }).click();
  await page.waitForURL(/\/map$/);
  await page.waitForTimeout(800); // let the zoom-out finish
  const offset = await page.evaluate((id) => {
    const canvas = document.querySelector("canvas")!.getBoundingClientRect();
    const hit = window.__farabiMapHitTest!(canvas.left + canvas.width / 2, canvas.top + canvas.height / 2);
    return hit === id;
  }, root);
  expect(offset).toBe(true);
});
