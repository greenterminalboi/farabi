import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { resetDb } from "./helpers";

test.beforeAll(async () => {
  await resetDb();
  rmSync(".feedback-test/attachments", { recursive: true, force: true });
  execFileSync("npx", ["tsx", "scripts/seed-large.ts", "--test", "--feedback", "200"], {
    stdio: "inherit",
    env: { ...process.env, FEEDBACK_DIR: ".feedback-test" },
  });
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
  await page.mouse.dblclick(point!.x, point!.y);
  await page.waitForURL(new RegExp(`/n/${target}$`));
  await expect(page.getByTestId("message").first()).toBeVisible();
  const navMs = Date.now() - t1;

  console.log({ mapMs, navMs });
  expect(mapMs).toBeLessThan(1000);
  expect(navMs).toBeLessThan(1000);
});

test("Definitions tab, marked terms and hover cards stay fast at 500 terms (SC-009, SC-009a)", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const t0 = Date.now();
  await page.getByRole("link", { name: "Definitions", exact: true }).click();
  await expect(page.getByTestId("definition-card")).toHaveCount(500);
  const tabMs = Date.now() - t0;

  // A conversation whose replies mention "Containers" (a collected term).
  const t1 = Date.now();
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const mark = page.locator("[data-testid=message] .term-mark").first();
  await expect(mark).toBeVisible();
  const convMs = Date.now() - t1;

  // Wait until the conversation's open animation has finished (as a person would see it), so
  // only the card's own time is measured.
  await mark.hover({ trial: true });
  const t2 = Date.now();
  await mark.hover();
  await expect(page.getByTestId("term-card")).toContainText("General meaning of Containers");
  const cardMs = Date.now() - t2;

  console.log({ tabMs, convMs, cardMs });
  expect(tabMs).toBeLessThan(1000);
  expect(convMs).toBeLessThan(1000);
  expect(cardMs).toBeLessThan(300);
});

test("dragging a node at 500 nodes keeps up with the pointer (SC-006)", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  await page.waitForFunction(() => (window.__farabiMapDebug?.nodes.length ?? 0) === 500, null, { timeout: 10_000 });
  await page.getByRole("link", { name: "Map" }).click();
  await page.waitForTimeout(800); // let the zoom-out on arrival settle
  const target = await page.evaluate(() => window.__farabiMapDebug!.nodes.find((n) => !n.isRoot)!.id);
  const p = await page.evaluate((id) => window.__farabiMapScreenPoint!(id), target);
  const before = await page.evaluate((id) => window.__farabiMapDebug!.nodes.find((n) => n.id === id)!, target);
  await page.mouse.move(p!.x, p!.y);
  await page.mouse.down();
  // Record frame intervals in the page while the real mouse drags the node.
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __recording: boolean };
    w.__frames = [];
    w.__recording = true;
    let last = performance.now();
    const tick = (now: number) => {
      w.__frames.push(now - last);
      last = now;
      if (w.__recording) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(p!.x + 180, p!.y + 90, { steps: 30 });
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __recording: boolean };
    w.__recording = false;
    return w.__frames.slice(1);
  });
  await page.mouse.up();
  const after = await page.evaluate((id) => window.__farabiMapDebug!.nodes.find((n) => n.id === id)!, target);
  const sorted = [...frames].sort((a, b) => a - b);
  console.log({ frames: frames.length, medianFrameMs: Math.round(sorted[Math.floor(sorted.length / 2)]), maxFrameMs: Math.round(sorted.at(-1)!) });
  expect(after.x).toBeGreaterThan(before.x + 100); // the node followed the pointer
  // Rendering keeps pace while dragging: the typical frame stays within two 60 Hz frames.
  expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(34);
});

test("the feedback drawer opens and scrolls smoothly with 200 items and screenshots (SC-008)", async ({ page }) => {
  await page.goto("/map");
  const button = page.getByRole("button", { name: /^Feedback/ });
  await expect(button).toContainText("to confirm"); // the list has loaded in the background
  const t0 = Date.now();
  await button.click();
  const list = page.getByRole("list", { name: "Feedback items" });
  await expect(page.getByTestId("feedback-card")).toHaveCount(200);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const openMs = Date.now() - t0;

  // Scroll to the end in steps while recording frame intervals in the page.
  const frames = await list.evaluate(async (el) => {
    const intervals: number[] = [];
    let last = performance.now();
    let recording = true;
    const tick = (now: number) => {
      intervals.push(now - last);
      last = now;
      if (recording) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    while (el.scrollTop + el.clientHeight < el.scrollHeight - 1) {
      el.scrollTop += 120;
      await new Promise((r) => requestAnimationFrame(r));
    }
    recording = false;
    return intervals.slice(1);
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  console.log({ openMs, frames: frames.length, medianFrameMs: Math.round(median), p95FrameMs: Math.round(p95) });
  expect(openMs).toBeLessThan(1000);
  expect(median).toBeLessThan(34);
  expect(p95).toBeLessThan(50);
});
