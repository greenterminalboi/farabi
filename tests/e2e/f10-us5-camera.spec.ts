import { expect, type Page, test } from "@playwright/test";
import { ask, cameraState, canvasDebug, elementsOf, focusElement, openCanvas, resetDb, setAiMode, startTree } from "./helpers";

// Story 5: move around a big map (quickstart §3.4; FR-025, FR-027, FR-028; SC-008, SC-012).

test.beforeEach(async ({ page }) => {
  await resetDb();
  await setAiMode(page, "ok");
});

const minimap = (page: Page) => page.evaluate(() => window.__farabiMinimap!());

async function inView(page: Page, id: string) {
  const box = await page.getByTestId("canvas").boundingBox();
  const pt = await page.evaluate((id) => window.__farabiScreenPoint!(id, "frame"), id);
  return !!box && !!pt && pt.x >= box.x && pt.x <= box.x + box.width && pt.y >= box.y && pt.y <= box.y + box.height;
}

test("Alt+arrows walk the graph and the camera follows within 1 s (scenario 1)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Pods");
  await ask(page, "Services");
  const [first] = await elementsOf(page, "answer");
  await focusElement(page, first.id);
  await ask(page, "Volumes"); // a sibling of "Services"
  const idOf = (text: string) => page.locator(".element-text.question").filter({ hasText: text }).getAttribute("data-node-id");
  const [origin, services, volumes] = [await idOf("Pods"), await idOf("Services"), await idOf("Volumes")];

  const walk = async (key: string, to: string | null) => {
    await page.keyboard.press(key);
    await expect.poll(async () => (await cameraState(page)).target).toBe(to);
    expect((await cameraState(page)).mode).toBe("follow");
  };
  await focusElement(page, first.id);
  await walk("Alt+ArrowUp", origin);
  await walk("Alt+ArrowDown", first.id);
  await walk("Alt+ArrowDown", services);
  const started = Date.now();
  await walk("Alt+ArrowRight", volumes);
  await expect.poll(() => inView(page, volumes!), { timeout: 1000 }).toBe(true);
  expect(Date.now() - started).toBeLessThan(1500);
  await walk("Alt+ArrowLeft", services);
});

test("a manual pan frees the camera, and nothing else moves it (scenario 2, SC-008)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Pods");
  // A reply that is still arriving when the user pans away.
  await setAiMode(page, "ok", 0, 300);
  const box = page.getByTestId("composer").getByLabel("Message");
  await box.fill("A slow one");
  await box.press("Enter");
  const canvas = (await page.getByTestId("canvas").boundingBox())!;
  await page.mouse.move(canvas.x + 200, canvas.y + 300);
  await page.mouse.wheel(0, 300);
  await expect.poll(async () => (await cameraState(page)).mode).toBe("free");
  await page.waitForTimeout(500); // let the pan itself finish
  const before = await cameraState(page);
  // The reply finishes, and another tree grows (through the API, then a refetch).
  await expect(page.locator(".element-text.status-pending")).toHaveCount(0, { timeout: 15_000 });
  const projectId = (await (await page.request.get("/api/projects")).json()).currentId;
  await page.request.post("/api/trees?wait=1", { data: { projectId, content: "Another tree" } });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(async () => (await canvasDebug(page)).elements.length).toBe(6);
  const after = await cameraState(page);
  expect(after.moves).toBe(before.moves);
  expect([after.x, after.y, after.scale]).toEqual([before.x, before.y, before.scale]);
});

test("the minimap shows the project and moves the camera within 100 ms; it can be hidden (scenario 3, SC-012)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Pods");
  await ask(page, "Services");
  const map = await minimap(page);
  expect(map.visible).toBe(true);
  expect(map.bounds).not.toBeNull();
  // The panel is 220×160 at the bottom-right of the canvas.
  const panel = page.getByTestId("minimap");
  const box = (await panel.boundingBox())!;
  const canvas = (await page.getByTestId("canvas").boundingBox())!;
  expect([box.width, box.height]).toEqual([220, 160]);
  expect(Math.round(canvas.x + canvas.width - (box.x + box.width))).toBe(12);
  const t0 = Date.now();
  await panel.click({ position: { x: 30, y: 30 } });
  await expect.poll(async () => (await minimap(page)).viewport.x, { timeout: 500 }).not.toBe(map.viewport.x);
  expect(Date.now() - t0).toBeLessThan(500);
  expect((await cameraState(page)).mode).toBe("free");
  // Drag moves it continuously.
  const v1 = (await minimap(page)).viewport;
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 70, { steps: 5 });
  await page.mouse.up();
  const v2 = (await minimap(page)).viewport;
  expect(v2.x).not.toBe(v1.x);
  // The rectangle is the camera's view.
  const cam = await cameraState(page);
  expect(Math.abs(v2.x + v2.w / 2 - cam.x)).toBeLessThan(1);
  expect(Math.abs(v2.y + v2.h / 2 - cam.y)).toBeLessThan(1);

  await page.getByTestId("minimap-toggle").click();
  await expect(panel).toBeHidden();
  await expect.poll(async () => (await minimap(page)).visible).toBe(false);
  await openCanvas(page);
  await expect.poll(async () => (await minimap(page)).visible).toBe(false);
  await page.getByTestId("minimap-toggle").click();
  await expect.poll(async () => (await minimap(page)).visible).toBe(true);
});

test("reopening the project restores the camera (scenario 4, FR-028)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Pods");
  await page.evaluate(() => window.__farabiSetCamera!(123, 456, 0.75));
  await page.waitForTimeout(900); // saved after 500 ms idle
  const saved = await cameraState(page);
  await openCanvas(page);
  await expect.poll(async () => {
    const c = await cameraState(page);
    return [Math.round(c.x), Math.round(c.y), c.scale];
  }).toEqual([Math.round(saved.x), Math.round(saved.y), 0.75]);
});
