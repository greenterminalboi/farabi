import { expect, test } from "@playwright/test";
import { ask, cameraState, canvasDebug, elementsOf, focusElement, openCanvas, resetDb, setAiMode, waitForReplyEnd } from "./helpers";

// Story 1: ask on the canvas and watch the answer arrive (quickstart §3.1).

test.beforeEach(async ({ page }) => {
  await resetDb();
  await setAiMode(page, "ok");
});

/** Is the element's frame inside the visible canvas? */
async function inView(page: import("@playwright/test").Page, id: string) {
  const box = await page.getByTestId("canvas").boundingBox();
  const pt = await page.evaluate((id) => window.__farabiScreenPoint!(id, "frame"), id);
  return !!box && !!pt && pt.x >= box.x && pt.x <= box.x + box.width && pt.y >= box.y && pt.y <= box.y + box.height;
}

test("an empty project starts a tree, and the answer streams in with Stop (scenario 1)", async ({ page }) => {
  await openCanvas(page);
  await expect(page.getByTestId("empty-state")).toContainText("Ask anything to start a tree");
  await expect(page.getByTestId("composer").getByLabel("Message")).toHaveAttribute("placeholder", "Start a new tree…");

  await setAiMode(page, "ok", 0, 250);
  const box = page.getByTestId("composer").getByLabel("Message");
  await box.fill("Explain Kubernetes pods");
  await box.press("Enter");
  // Progressive text, with Stop, while it streams.
  await expect(page.getByTestId("streaming")).toBeVisible();
  await expect(page.getByTestId("composer").getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(page.locator(".element-text.answer").getByRole("button", { name: "Stop" })).toBeVisible();
  const answer = page.locator(".element-text.answer");
  await expect(answer).toContainText("Echo:");
  const partial = (await answer.textContent()) ?? "";
  await waitForReplyEnd(page);
  await expect(answer).toContainText("Echo: Explain Kubernetes pods. Containers are mentioned here.");
  expect(partial.length).toBeLessThan(((await answer.textContent()) ?? "").length);

  await expect(page.getByTestId("empty-state")).toHaveCount(0);
  const question = page.locator(".element-text.question");
  await expect(question).toHaveText("Explain Kubernetes pods");
  await expect(question).toHaveAttribute("aria-label", "Your message");
  await expect(answer).toHaveAttribute("aria-label", "AI answer");
  await expect(answer.locator(".ai-tag")).toHaveText("AI");
});

test("follow-ups extend the column, a second ask fans right, and the camera follows (scenarios 2–4)", async ({ page }) => {
  await openCanvas(page);
  await ask(page, "Pods");
  const [first] = await elementsOf(page, "answer");
  await expect(page.getByTestId("composer").getByLabel("Message")).toHaveAttribute("placeholder", "Ask a follow-up…");

  await ask(page, "Services");
  let answers = await elementsOf(page, "answer");
  expect(answers).toHaveLength(2);
  const second = answers.find((a) => a.id !== first.id)!;
  // One column: the second answer sits straight below the first.
  expect(second.x).toBe(first.x);
  expect(second.y).toBeGreaterThan(first.y + first.h);
  const cam = await cameraState(page);
  expect(cam.mode).toBe("follow");
  expect(cam.target).toBe(second.id);
  expect(await inView(page, second.id)).toBe(true);

  // A second send from the first answer is a sibling to the right; the column doesn't move.
  await focusElement(page, first.id);
  const before = await canvasDebug(page);
  const started = Date.now();
  await ask(page, "Volumes");
  answers = await elementsOf(page, "answer");
  const third = answers.find((a) => a.id !== first.id && a.id !== second.id)!;
  expect(third.x).toBeGreaterThan(first.x + first.w);
  const after = await canvasDebug(page);
  for (const el of before.elements) {
    const now = after.elements.find((e) => e.id === el.id)!;
    expect([now.x, now.y]).toEqual([el.x, el.y]);
  }
  await expect.poll(() => inView(page, third.id), { timeout: 1000 }).toBe(true);
  expect(Date.now() - started).toBeLessThan(15_000);
  expect((await cameraState(page)).target).toBe(third.id);
});

test("when the AI is unreachable the question is kept and Retry recovers (scenario 5)", async ({ page }) => {
  await openCanvas(page);
  await setAiMode(page, "fail");
  await ask(page, "Offline question");
  const answer = page.locator(".element-text.answer");
  await expect(answer).toHaveAttribute("aria-label", "AI answer, failed");
  await expect(answer.locator(".element-footer")).toContainText("The reply failed.");
  await expect(page.locator(".element-text.question")).toHaveText("Offline question");

  await setAiMode(page, "ok");
  await answer.getByRole("button", { name: "Retry" }).click();
  await waitForReplyEnd(page);
  await expect(page.locator(".element-text.answer").filter({ hasText: "Echo: Offline question" })).toHaveCount(1);
  expect(await elementsOf(page, "answer")).toHaveLength(2);
});

test("a send that can't reach the server shows an error with Retry and keeps the draft (FR-015)", async ({ page }) => {
  await openCanvas(page);
  await ask(page, "First");
  await page.route("**/api/nodes/*/ask", (route) => route.abort());
  const box = page.getByTestId("composer").getByLabel("Message");
  await box.fill("Keep me");
  await box.press("Enter");
  await expect(page.getByTestId("composer").getByRole("alert")).toBeVisible();
  await expect(box).toHaveValue("Keep me");
  await page.unroute("**/api/nodes/*/ask");
  await page.getByTestId("composer").getByRole("button", { name: "Retry" }).click();
  await expect(box).toHaveValue("");
  await waitForReplyEnd(page);
  expect(await elementsOf(page, "answer")).toHaveLength(2);
});

test("drafts survive a reload, per target (FR-028)", async ({ page }) => {
  await openCanvas(page);
  await ask(page, "Pods");
  await page.getByTestId("composer").getByLabel("Message").fill("half a thought");
  await page.waitForTimeout(200);
  const [answer] = await elementsOf(page, "answer");
  await openCanvas(page, `/?focus=${answer.id}`);
  await expect(page.getByTestId("composer").getByLabel("Message")).toHaveValue("half a thought");
});
