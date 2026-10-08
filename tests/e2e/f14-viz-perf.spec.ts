// Feature 014 · SC-002: a 200-element scene animates within the frame budget (p95 ≤ 20 ms).
// Its own file because tracing (which snapshots every action and skews timings) must be off for
// the whole file, as in f10-scale.
import { expect, type Page, test } from "@playwright/test";

test.use({ trace: "off" });

const player = (page: Page) => page.getByTestId("viz-player");
const frame = async (page: Page) => Number(await player(page).getAttribute("data-frame"));

async function open(page: Page, scene: string) {
  await page.goto(`/dev/viz?scene=${scene}`);
  await expect(player(page)).toBeVisible();
  await expect(page.getByTestId("viz-counter")).toContainText("Step 0 of");
}

test("SC-002: a 200-element scene animates within the frame budget", async ({ page }) => {
  await open(page, "perf");
  const stats = await page.evaluate(async () => {
    const deltas: number[] = [];
    let last = performance.now();
    let running = true;
    const loop = (now: number) => {
      deltas.push(now - last);
      last = now;
      if (running) requestAnimationFrame(loop);
    };
    requestAnimationFrame((now) => {
      last = now;
      requestAnimationFrame(loop);
    });
    (document.querySelector('[data-testid="viz-play"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 4000));
    running = false;
    const sorted = [...deltas].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    return { frames: deltas.length, p50: q(0.5), p95: q(0.95), max: sorted[sorted.length - 1] };
  });
  console.log("viz p95 frame ms", JSON.stringify(stats));
  expect(await frame(page)).toBeGreaterThanOrEqual(3);
  expect(stats.frames).toBeGreaterThan(120);
  expect(stats.p95).toBeLessThanOrEqual(20);
});
