import { expect, test } from "@playwright/test";
import { openCanvas, resetDb, setAiMode, startTree } from "./helpers";

// Feature 11 T023: the desktop app's content security policy blocks nothing the app needs. Runs in
// the packaged server in desktop mode, which applies it.

test.beforeEach(async ({ page }) => {
  await resetDb();
  await page.addInitScript(() => {
    const w = window as unknown as { __cspViolations: string[] };
    w.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__cspViolations.push(`${e.effectiveDirective} ${e.blockedURI}`));
  });
});

const violations = (page: import("@playwright/test").Page) => page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);

test("the canvas, a streamed reply, Settings, Definitions and Feedback run under the policy", async ({ page }) => {
  const res = await page.goto("/");
  const policy = res!.headers()["content-security-policy"];
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("frame-ancestors 'none'");

  await setAiMode(page, "slow", 0, 20);
  await openCanvas(page);
  // Streams over SSE and draws on the canvas (Pixi, workers, blobs).
  await startTree(page, "What is a pod?");

  await page.goto("/settings");
  await expect(page.getByTestId("app-settings")).toBeVisible();
  await page.goto("/definitions");
  await page.getByRole("button", { name: "Feedback" }).click();
  await page.keyboard.press("Escape");
  await page.goto("/");
  await openCanvas(page);

  expect(await violations(page)).toEqual([]);
});
