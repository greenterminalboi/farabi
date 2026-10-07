import { expect, test } from "@playwright/test";
import { canvasDebug, openCanvas, resetDb } from "./helpers";

// Story 4: existing work survives the move (quickstart §1; FR-063–FR-066; research R18).

test.beforeEach(resetDb);

test("a converted v1 conversation reads as a column, keeps its branch and terms, and old links land on it", async ({ page }) => {
  await openCanvas(page);
  const projectId = (await (await page.request.get("/api/projects")).json()).currentId as string;
  const res = await page.request.post("/api/test/convert-v1", { data: { projectId } });
  expect(res.ok()).toBeTruthy();
  const { conversationId } = (await res.json()) as { conversationId: string; branchId: string };

  await openCanvas(page);
  await expect(page.locator(".element-text.question").filter({ hasText: "What are pods?" })).toBeVisible();
  const answer = page.locator(".element-text.answer").filter({ hasText: "Pods are" });
  await expect(answer).toBeVisible();
  // The branch marker and the definition underline render on the converted answer.
  await expect(answer.locator("[data-markers]")).toHaveText("groups");
  await expect(answer.locator(".term-mark").first()).toHaveText("Pods");
  // The question and answer form one column; the branch fans to the right.
  const debug = await canvasDebug(page);
  const [q, a] = ["question", "answer"].map((k) => debug.elements.filter((e) => e.kind === k).sort((x, y) => x.x - y.x)[0]);
  expect(a.y).toBeGreaterThan(q.y);
  expect(debug.elements.filter((e) => e.kind === "question").some((e) => e.x > a.x + a.w)).toBe(true);

  // An old /n/<conversation> link opens the canvas focused on its first edge.
  await page.goto(`/n/${conversationId}`);
  await page.waitForURL(/\?focus=/);
  await page.waitForFunction(() => typeof window.__farabiCanvasDebug === "function");
  const focusId = new URL(page.url()).searchParams.get("focus");
  await expect
    .poll(async () => (await canvasDebug(page)).elements.find((e) => e.focused)?.id)
    .toBe(focusId);
  await expect(page.locator(`[data-node-id="${focusId}"]`)).toHaveText("What are pods?");
});
