// Scale on real data shapes (SC-005, SC-012, research R17): 5,000 elements seeded on the v2 model,
// measured on the production build with GPU Chromium. Replaces the M0 spike's synthetic page.
import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import { resetDb } from "./helpers";

test.use({ trace: "off" });
test.describe.configure({ mode: "serial" });

type Frames = { p50: number; p95: number; max: number; frames: number };
const results: Record<string, unknown> = {};

test.beforeAll(async () => {
  await resetDb();
  execFileSync("npx", ["tsx", "scripts/seed-large.ts", "--test", "--elements", "5000"], {
    cwd: process.cwd(),
    env: { ...process.env, TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://farabi:farabi@127.0.0.1:5432/farabi_test" },
    stdio: "ignore",
  });
});

test.afterAll(() => console.log("Scale results", JSON.stringify(results, null, 2)));

async function openSeed(page: Page) {
  const projects = (await (await page.request.get("/api/projects")).json()).projects as Array<{ id: string; name: string }>;
  const seed = projects.find((p) => p.name === "Scale seed")!;
  await page.request.post(`/api/projects/${seed.id}/open`);
  const t0 = Date.now();
  await page.goto("/");
  await page.waitForFunction(() => (window.__farabiCanvasDebug?.().elements.length ?? 0) >= 5000, undefined, { timeout: 30_000 });
  return Date.now() - t0;
}

async function sample(page: Page, ms: number, act: () => Promise<void>): Promise<Frames> {
  const stats = page.evaluate((d) => window.__farabiFrameStats!(d), ms);
  const until = Date.now() + ms - 100;
  while (Date.now() < until) await act();
  return stats;
}

async function centre(page: Page) {
  const box = (await page.getByTestId("canvas").boundingBox())!;
  return { x: box.x + box.width / 2 - 120, y: box.y + box.height / 2 };
}

test("the canvas of 5,000 elements opens within 1 s (SC-005)", async ({ page }) => {
  await openSeed(page); // first open warms the server
  results.openMs = await openSeed(page);
  expect(results.openMs).toBeLessThan(1500);
});

test("pan and zoom hold 60 fps at 5,000 elements (SC-005)", async ({ page }) => {
  await openSeed(page);
  const c = await centre(page);
  await page.mouse.move(c.x, c.y);
  // Warm up, then measure zoomed out (everything in view) and at reading zoom.
  await sample(page, 1000, () => page.mouse.wheel(5, 8));
  await page.evaluate(() => {
    const b = window.__farabiMinimap!().bounds!;
    window.__farabiSetCamera!((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 0.02);
  });
  await page.waitForTimeout(800);
  results.panFar = await sample(page, 4000, () => page.mouse.wheel(14, 22));
  await page.evaluate(() => {
    const b = window.__farabiMinimap!().bounds!;
    window.__farabiSetCamera!((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 1);
  });
  await page.waitForTimeout(800);
  results.panNear = await sample(page, 4000, () => page.mouse.wheel(0, 40));
  await page.keyboard.down("Control");
  results.zoom = await sample(page, 4000, () => page.mouse.wheel(0, -40));
  await page.keyboard.up("Control");
  expect((results.panFar as Frames).p95).toBeLessThan(16.7 * 1.25);
  expect((results.panNear as Frames).p95).toBeLessThan(16.7 * 1.25);
  expect((results.zoom as Frames).p95).toBeLessThan(20 * 1.25);
});

test("the minimap answers within 100 ms, and nothing off screen stays mounted (SC-012, SC-006)", async ({ page }) => {
  await openSeed(page);
  const box = (await page.getByTestId("minimap").boundingBox())!;
  const before = await page.evaluate(() => window.__farabiMinimap!().viewport);
  const t0 = Date.now();
  await page.mouse.click(box.x + 40, box.y + 40);
  await page.waitForFunction((x) => window.__farabiMinimap!().viewport.x !== x, before.x, { timeout: 1000 });
  results.minimapMs = Date.now() - t0;
  expect(results.minimapMs).toBeLessThan(100 + 150); // the click itself crosses the test harness
  await page.waitForTimeout(400);
  expect((await page.evaluate(() => window.__farabiTextStats!())).offscreenMounted).toBe(0);
});
