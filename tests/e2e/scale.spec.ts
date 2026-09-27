import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { resetDb } from "./helpers";

test.beforeAll(async () => {
  await resetDb();
  execFileSync("npx", ["tsx", "scripts/seed-large.ts", "--test"], { stdio: "inherit" });
});

test("map and navigation stay under 1 s at 500 nodes (SC-006)", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  // The map is prepared in the background once the app is idle (research R7); measure opening it
  // as a user would after the app has loaded, not in the first instant after page load.
  await page.waitForFunction(() => (window.__farabiMapDebug?.nodes.length ?? 0) === 500, null, {
    timeout: 10_000,
  });
  const t0 = Date.now();
  await page.getByRole("link", { name: "Map" }).click();
  await expect
    .poll(async () => page.evaluate(() => window.__farabiMapDebug?.nodes.length ?? 0), { intervals: [50] })
    .toBe(500);
  // Wait until the frame with all nodes has actually been painted.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const mapMs = Date.now() - t0;

  const target = await page.evaluate(() => window.__farabiMapDebug!.nodes[250].id);
  const point = await page.evaluate((id) => window.__farabiMapScreenPoint?.(id), target);
  const t1 = Date.now();
  await page.mouse.click(point!.x, point!.y);
  await page.waitForURL(new RegExp(`/n/${target}$`));
  await expect(page.getByTestId("message").first()).toBeVisible();
  const navMs = Date.now() - t1;

  console.log({ mapMs, navMs });
  expect(mapMs).toBeLessThan(1000);
  expect(navMs).toBeLessThan(1000);
});
