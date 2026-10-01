// Milestone M0 (research R17, quickstart §0): 5,000 elements of real, selectable text over the
// canvas must hold 60 fps. Measured on the production build with GPU Chromium.
import { expect, type Page, test } from "@playwright/test";

const N = 5000;

// Trace recording snapshots the page continuously; frame timings must be measured without it.
test.use({ trace: "off" });

type Frames = { p50: number; p95: number; max: number; frames: number };

async function open(page: Page, query = "") {
  await page.goto(`/dev/canvas-spike?n=${N}${query}`);
  await page.waitForFunction(() => window.__farabiSpike?.ready != null, undefined, { timeout: 30_000 });
  return page.evaluate(() => ({
    readyMs: window.__farabiSpike!.ready!,
    layerMs: window.__farabiSpike!.ready! - window.__farabiSpike!.layerStart,
    stats: window.__farabiTextStats!(),
  }));
}

/**
 * Lets the first fill settle and warms the page up with a short pan before timing frames: the
 * very first gesture after load also pays for JIT and GPU start-up, which isn't steady-state
 * performance (research R17).
 */
async function settle(page: Page) {
  await page.evaluate(() => window.__farabiFrameStats!(1500));
  const c = await centre(page);
  await page.mouse.move(c.x, c.y);
  const until = Date.now() + 1000;
  while (Date.now() < until) await page.mouse.wheel(5, 8);
  await page.evaluate(() => window.__farabiFrameStats!(500));
}

/** Samples frame times for `ms` while `act` runs input. */
async function sample(page: Page, ms: number, act: () => Promise<void>): Promise<Frames> {
  const stats = page.evaluate((d) => window.__farabiFrameStats!(d), ms);
  const until = Date.now() + ms - 100;
  while (Date.now() < until) await act();
  return stats;
}

async function centre(page: Page) {
  const box = (await page.getByTestId("canvas").boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const results: Record<string, unknown> = {};

test.afterAll(() => {
  console.log("M0 results", JSON.stringify(results, null, 2));
});

test("opens with every element in view within 1 s of getting its items", async ({ page }) => {
  const { readyMs, layerMs, stats } = await open(page);
  results.open = { readyMs: Math.round(readyMs), layerMs: Math.round(layerMs), mounted: stats.mounted, chars: stats.chars };
  // Every one of the 5,000 elements shows real text at the furthest zoom (story 2).
  expect(stats.mounted).toBe(N);
  expect(layerMs).toBeLessThan(1000);
});

test("panning holds 60 fps, zoomed out and zoomed in", async ({ page }) => {
  await open(page);
  await settle(page);
  const c = await centre(page);
  await page.mouse.move(c.x, c.y);

  results.panFar = await sample(page, 5000, () => page.mouse.wheel(14, 22));
  expect((results.panFar as Frames).p95).toBeLessThan(16.7 * 1.25);

  await page.evaluate(() => {
    const b = window.__farabiSpike!.bounds;
    window.__farabiSpike!.setCamera(0.35, b.maxX / 2, b.maxY / 2);
  });
  await page.waitForTimeout(500);
  results.panMid = await sample(page, 5000, () => page.mouse.wheel(-10, 30));

  await page.evaluate(() => {
    const b = window.__farabiSpike!.bounds;
    window.__farabiSpike!.setCamera(1, b.maxX / 2, b.maxY / 2);
  });
  await page.waitForTimeout(500);
  results.panNear = await sample(page, 5000, () => page.mouse.wheel(0, 40));

  for (const key of ["panMid", "panNear"]) expect((results[key] as Frames).p95, key).toBeLessThan(16.7 * 1.25);
});

test("zoom steps from the furthest to the closest zoom stay smooth", async ({ page }) => {
  await open(page);
  await settle(page);
  const c = await centre(page);
  await page.mouse.move(c.x, c.y);
  await page.keyboard.down("Control");
  results.zoomIn = await sample(page, 5000, () => page.mouse.wheel(0, -40));
  results.zoomOut = await sample(page, 5000, () => page.mouse.wheel(0, 40));
  await page.keyboard.up("Control");
  for (const key of ["zoomIn", "zoomOut"]) expect((results[key] as Frames).p95, key).toBeLessThan(20 * 1.25);
});

test("text is selectable at the furthest zoom, and off-screen text is unmounted", async ({ page }) => {
  await open(page);
  // A mounted item near the centre of the screen.
  const point = await page.evaluate(() => {
    const ids = window.__farabiSpike!.ids;
    const pts = ids.map((id) => window.__farabiSpike!.textPoint(id)).filter((p) => p !== null);
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    pts.sort((a, b) => Math.hypot(a!.x - cx, a!.y - cy) - Math.hypot(b!.x - cx, b!.y - cy));
    return pts[0];
  });
  expect(point).not.toBeNull();
  const y = point!.y + point!.height / 2;
  // The word is a couple of pixels wide at this zoom: drag from just inside its start to its end.
  await page.mouse.move(point!.x + point!.width * 0.02, y);
  await page.mouse.down();
  await page.mouse.move(point!.x + point!.width * 0.98, y, { steps: 6 });
  await page.mouse.up();
  const selected = await page.evaluate(() => document.getSelection()?.toString() ?? "");
  results.farSelection = selected;
  expect(selected.trim().length).toBeGreaterThan(0);

  // Zoom right in and pan far away: nothing off-screen stays mounted once the camera rests.
  await page.evaluate(() => window.__farabiSpike!.setCamera(1.5, 300, 300));
  await page.waitForTimeout(400);
  const stats = await page.evaluate(() => window.__farabiTextStats!());
  results.zoomedInStats = stats;
  expect(stats.offscreenMounted).toBe(0);
  expect(stats.mounted).toBeLessThan(60);
});
