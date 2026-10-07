import { expect, type Page, test } from "@playwright/test";
import { ask, cameraState, canvasDebug, elementsOf, focusElement, openCanvas, resetDb, selectInElement, setAiMode, startTree, waitForReplyEnd } from "./helpers";

// Story 3: branch from anywhere (quickstart §3.3; FR-016–FR-022).

test.beforeEach(async ({ page }) => {
  await resetDb();
  await setAiMode(page, "ok");
});

const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Highlight actions" });
const composerBox = (page: Page) => page.getByTestId("composer").getByLabel("Message");

async function branch(page: Page, id: string, phrase: string, question = "", action: "Branch" | "Park" = "Branch") {
  await selectInElement(page, id, phrase);
  await toolbar(page).getByRole("button", { name: action }).click();
  const form = page.getByTestId("branch-question-form");
  if (question) await form.getByLabel("Your question (optional)").fill(question);
  await form.getByLabel("Your question (optional)").press("Enter");
  // A branch takes the focus, and the composer moves to it, preloaded.
  if (action === "Branch") await expect(composerBox(page)).toHaveAttribute("placeholder", "Ask about the highlighted text…");
}

test("Branch from an answer span: an unsent edge with a marker, and the composer preloaded (scenario 1, FR-017)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Pods");
  const [answer] = await elementsOf(page, "answer");
  await branch(page, answer.id, "Containers");
  // The marker is on the span, the new edge is unsent and focused, the draft is the anchor text.
  await expect(page.locator(`[data-node-id="${answer.id}"] [data-markers]`)).toHaveText("Containers");
  const edges = await elementsOf(page, "question");
  expect(edges).toHaveLength(2);
  const unsent = edges.find((e) => e.focused)!;
  await expect(page.locator(`[data-node-id="${unsent.id}"]`)).toHaveClass(/state-unsent/);
  await expect(composerBox(page)).toHaveValue("Containers");
  await expect(composerBox(page)).toHaveAttribute("placeholder", "Ask about the highlighted text…");
  // No reply until the user sends.
  expect(await elementsOf(page, "answer")).toHaveLength(1);
  await composerBox(page).fill("Why containers?");
  await composerBox(page).press("Enter");
  await expect(composerBox(page)).toHaveValue("");
  await waitForReplyEnd(page);
  expect(await elementsOf(page, "answer")).toHaveLength(2);
  await expect(page.locator(`[data-node-id="${unsent.id}"]`)).toHaveText("Why containers?");
});

test("Branch from the user's own words: the question edge is the source (scenario 2)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Tell me about scheduling");
  const [question] = await elementsOf(page, "question");
  await branch(page, question.id, "scheduling", "Which scheduler?");
  await expect(composerBox(page)).toHaveValue("Which scheduler?");
  await composerBox(page).press("Enter");
  await expect(composerBox(page)).toHaveValue("");
  await waitForReplyEnd(page);
  const debug = await canvasDebug(page);
  expect(debug.elements.filter((e) => e.kind === "question")).toHaveLength(2);
  await expect(page.locator(`[data-node-id="${question.id}"] [data-markers]`)).toHaveText("scheduling");
});

test("???? re-asks the focused answer's question as a sibling (scenario 3, FR-020)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Pods");
  await ask(page, "What is a sidecar?");
  const before = await elementsOf(page, "question");
  await composerBox(page).fill("????");
  await waitForReplyEnd(page);
  await expect.poll(async () => (await elementsOf(page, "question")).length).toBe(3);
  await expect(page.locator(".element-text.question").filter({ hasText: "What is a sidecar?" })).toHaveCount(2);
  await expect(page.locator(".element-text.question").filter({ hasText: "????" })).toHaveCount(0);
  // The new sibling sits to the right of the original; the camera follows it.
  const after = await elementsOf(page, "question");
  const sibling = after.find((q) => !before.some((b) => b.id === q.id))!;
  const original = before.find((q) => q.y === sibling.y)!;
  expect(sibling.x).toBeGreaterThan(original.x);
  expect((await cameraState(page)).mode).toBe("follow");
});

test("Park, then fire with and without a question (scenario 4, FR-021)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Pods");
  const [answer] = await elementsOf(page, "answer");
  await branch(page, answer.id, "Containers", "Why?", "Park");
  await expect(page.getByTestId("parked-notice")).toBeVisible();
  await focusElement(page, answer.id);
  await page.getByRole("tab", { name: /Parked/ }).click();
  const item = page.getByTestId("parked-item");
  await expect(item).toContainText("Containers");
  await expect(item).toContainText("Why?");
  // Parking created nothing on the canvas.
  expect(await elementsOf(page, "question")).toHaveLength(1);
  await item.getByRole("button", { name: "Ask in new branch" }).click();
  await expect.poll(async () => (await elementsOf(page, "question")).length).toBe(2);
  await waitForReplyEnd(page);
  expect(await elementsOf(page, "answer")).toHaveLength(2);
  await expect(page.locator(".element-text.question").filter({ hasText: "Why?" })).toHaveCount(1);

  // Without a question: an unsent edge, the composer holding the anchor text.
  await focusElement(page, answer.id);
  await branch(page, answer.id, "mentioned", "", "Park");
  await focusElement(page, answer.id);
  await page.getByRole("tab", { name: /Parked/ }).click();
  await page.getByTestId("parked-item").getByRole("button", { name: "Open as branch" }).click();
  await expect(composerBox(page)).toHaveValue("mentioned");
});

test("a marker click walks to its edge, and the side panel lists child edges newest first (scenario 5, FR-018, FR-022)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Pods");
  const [answer] = await elementsOf(page, "answer");
  await ask(page, "First follow-up");
  await focusElement(page, answer.id);
  await branch(page, answer.id, "Containers", "Branched");
  await composerBox(page).press("Enter");
  await expect(composerBox(page)).toHaveValue("");
  await waitForReplyEnd(page);

  await focusElement(page, answer.id);
  const rows = page.getByTestId("branch-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Branched");
  await expect(rows.first()).toContainText("“Containers”");
  await expect(rows.nth(1)).toContainText("First follow-up");

  // Pan away, then click the marker: the camera follows to the branch edge.
  const debug = await canvasDebug(page);
  const a = debug.elements.find((e) => e.id === answer.id)!;
  await page.evaluate(([x, y]) => window.__farabiSetCamera!(x, y, 1), [a.x + 240, a.y + 40] as const);
  await page.waitForTimeout(300);
  await page.locator(`[data-node-id="${answer.id}"] [data-markers]`).click();
  const branchEdge = page.locator(".element-text.question").filter({ hasText: "Branched" });
  const edgeId = await branchEdge.getAttribute("data-node-id");
  await expect.poll(async () => (await cameraState(page)).target).toBe(edgeId);
  await expect.poll(async () => (await elementsOf(page, "question")).find((q) => q.focused)?.id).toBe(edgeId);
  // A panel entry walks there too.
  await page.evaluate(([x, y]) => window.__farabiSetCamera!(x, y, 1), [a.x + 240, a.y + 40] as const);
  await focusElement(page, answer.id);
  await rows.nth(1).click();
  await expect.poll(async () => (await cameraState(page)).mode).toBe("follow");
  const followUpId = await page.locator(".element-text.question").filter({ hasText: "First follow-up" }).getAttribute("data-node-id");
  await expect.poll(async () => (await cameraState(page)).target).toBe(followUpId);
});
