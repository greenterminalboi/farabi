import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { resetDb } from "./helpers";

const OUTPUTS = 50;

test.beforeAll(async () => {
  await resetDb();
  execFileSync("npx", ["tsx", "scripts/seed-large.ts", "--test", "--outputs", String(OUTPUTS)], { stdio: "inherit" });
});

test("map and node views stay under 1 s with 500 conversations plus outputs (Feature 9, SC-009)", async ({ page }) => {
  const total = 500 + OUTPUTS;
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  await page.waitForFunction((n) => (window.__farabiMapDebug?.nodes.length ?? 0) === n, total, { timeout: 15_000 });
  const t0 = Date.now();
  await page.getByRole("link", { name: "Map" }).click();
  await expect
    .poll(async () => page.evaluate(() => window.__farabiMapDebug?.nodes.length ?? 0), { intervals: [50] })
    .toBe(total);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const mapMs = Date.now() - t0;
  expect((await page.evaluate(() => window.__farabiMapDebug!.pipes.length))).toBe(OUTPUTS);

  const output = await page.evaluate(() => window.__farabiMapDebug!.nodes.find((n) => n.kind === "analogy")!.id);
  const point = await page.evaluate((id) => window.__farabiMapScreenPoint?.(id), output);
  const t1 = Date.now();
  await page.mouse.dblclick(point!.x, point!.y);
  await page.waitForURL(new RegExp(`/n/${output}$`));
  await expect(page.getByTestId("output-text")).toBeVisible();
  const navMs = Date.now() - t1;

  console.log({ mapMs, navMs });
  expect(mapMs).toBeLessThan(1000);
  expect(navMs).toBeLessThan(1000);
});
