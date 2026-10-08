import { expect, type Page } from "@playwright/test";
import { AUTH, E2E_BASE, E2E_DATA_DIR } from "./env";

export { E2E_DATA_DIR };

/** An empty store before a test: the app's test-only reset route (the store is in-process). */
export async function resetDb(): Promise<void> {
  const res = await fetch(`${E2E_BASE}/api/test/reset`, { method: "POST", headers: AUTH });
  if (!res.ok) throw new Error(`reset failed: ${res.status}`);
}

/** A node's stored text and properties, as written. */
export async function storedNode(id: string): Promise<{ text: string | null; properties: unknown }> {
  const res = await fetch(`${E2E_BASE}/api/test/node/${id}`, { headers: AUTH });
  if (!res.ok) throw new Error(`node ${id}: ${res.status}`);
  return res.json();
}

/** The scale seed, inside the running app. */
export async function seedLarge(body: { elements?: number; feedback?: number }): Promise<void> {
  const res = await fetch(`${E2E_BASE}/api/test/seed-large`, { method: "POST", headers: { ...AUTH, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`seed failed: ${res.status}`);
}

export async function setAiMode(page: Page, mode: "ok" | "fail" | "slow" | "stall", delayMs?: number, chunkDelayMs?: number) {
  const res = await page.request.post("/api/test/ai-mode", { data: { mode, delayMs, chunkDelayMs } });
  expect(res.ok()).toBeTruthy();
}

// Canvas test hooks (contracts/canvas-ui.md "Test hooks").

export type DebugElement = {
  id: string;
  kind: "answer" | "question" | "output" | "function_connector" | "drill";
  shape: "node" | "edge";
  x: number;
  y: number;
  w: number;
  h: number;
  treeId: string;
  focused: boolean;
  onPath: boolean;
};

export async function canvasDebug(page: Page): Promise<{ elements: DebugElement[]; trees: Record<string, { minX: number; minY: number; maxX: number; maxY: number }> }> {
  return page.evaluate(() => window.__farabiCanvasDebug!());
}

export async function cameraState(page: Page) {
  return page.evaluate(() => window.__farabiCamera!());
}

export async function textStats(page: Page) {
  return page.evaluate(() => window.__farabiTextStats!());
}

/** Opens the canvas and waits until it is ready to use. */
export async function openCanvas(page: Page, path = "/") {
  await page.goto(path);
  await page.waitForFunction(() => typeof window.__farabiCanvasDebug === "function" && typeof window.__farabiCamera === "function");
  await expect(page.getByTestId("composer").or(page.getByTestId("empty-state")).first()).toBeVisible();
}

/** Waits until no reply is streaming on the canvas. */
export async function waitForReplyEnd(page: Page) {
  await expect(page.locator(".element-text.status-pending")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
}

/** Types into the composer and sends; resolves once the reply has ended. */
export async function ask(page: Page, text: string): Promise<void> {
  const box = page.getByTestId("composer").getByLabel("Message");
  await box.fill(text);
  await box.press("Enter");
  await expect(box).toHaveValue("");
  await waitForReplyEnd(page);
}

/** The ids of the elements of a kind, in creation order (the store's insertion order). */
export async function elementsOf(page: Page, kind: DebugElement["kind"]): Promise<DebugElement[]> {
  return (await canvasDebug(page)).elements.filter((e) => e.kind === kind);
}

/**
 * A screen point on an element's frame (its padding, not its text or buttons) that a press would
 * really land on. Like a user, it first brings the element into view when no such point is visible.
 */
export async function framePoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  await cameraSettled(page);
  const find = () =>
    page.evaluate((id) => {
      const item = document.querySelector<HTMLElement>(`[data-testid=element-text][data-node-id="${id}"]`);
      const r = item?.getBoundingClientRect();
      const canvas = document.querySelector("[data-testid=canvas]")!.getBoundingClientRect();
      if (!item || !r) return null;
      const candidates = [
        { x: r.left + 4, y: r.top + r.height / 2 },
        { x: r.right - 4, y: r.top + r.height / 2 },
        { x: r.left + r.width / 2, y: r.bottom - 4 },
        { x: r.left + 4, y: r.bottom - 4 },
      ];
      return (
        candidates.find(
          (p) =>
            p.x > canvas.left && p.x < canvas.right && p.y > canvas.top && p.y < canvas.bottom && document.elementFromPoint(p.x, p.y) === item,
        ) ?? null
      );
    }, id);
  let pt = await find();
  if (!pt) {
    const el = (await canvasDebug(page)).elements.find((e) => e.id === id);
    if (!el) throw new Error(`element ${id} is not on the canvas`);
    await page.evaluate(([x, y]) => window.__farabiSetCamera!(x, y, 1), [el.x + el.w / 2, el.y + el.h / 2] as const);
    await expect.poll(find, { timeout: 3000 }).not.toBeNull();
    pt = (await find())!;
  }
  return pt;
}

/** Waits until the camera has stopped moving (a glide after a send or a walk takes ~350 ms). */
export async function cameraSettled(page: Page) {
  let last = "";
  await expect
    .poll(async () => {
      const c = await cameraState(page);
      const now = `${c.x.toFixed(1)},${c.y.toFixed(1)},${c.scale}`;
      const same = now === last;
      last = now;
      return same;
    }, { intervals: [100], timeout: 5000 })
    .toBe(true);
}

/** Clicks an element's frame, which focuses it without moving the camera. */
export async function focusElement(page: Page, id: string) {
  const pt = await framePoint(page, id);
  await page.mouse.click(pt.x, pt.y);
  await expect.poll(async () => (await canvasDebug(page)).elements.find((e) => e.id === id)?.focused).toBe(true);
}

/** Selects `phrase` inside a mounted element's text by driving a DOM range, as a drag would. */
export async function selectInElement(page: Page, id: string, phrase: string) {
  const item = page.locator(`[data-testid=element-text][data-node-id="${id}"]`);
  await expect(item).toContainText(phrase);
  await page.evaluate(
    ({ id, phrase }) => {
      const item = document.querySelector<HTMLElement>(`[data-testid=element-text][data-node-id="${id}"] .element-body`)!;
      const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
      const full = nodes.map((n) => n.data).join("");
      const at = full.indexOf(phrase);
      if (at < 0) throw new Error(`phrase not found: ${phrase}`);
      const locate = (offset: number, isEnd: boolean) => {
        let seen = 0;
        for (const n of nodes) {
          const within = offset - seen;
          if (isEnd ? within <= n.data.length : within < n.data.length) return { node: n, offset: within };
          seen += n.data.length;
        }
        throw new Error("offset out of range");
      };
      const start = locate(at, false);
      const end = locate(at + phrase.length, true);
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      const sel = document.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    },
    { id, phrase },
  );
}

/**
 * Branch and Park ask for an optional question first (Feature 8); this confirms that step with
 * `question`, or blank.
 */
export async function confirmQuestion(page: Page, question = "") {
  const form = page.getByTestId("branch-question-form");
  if (question) await form.getByLabel("Your question (optional)").fill(question);
  await form.getByLabel("Your question (optional)").press("Enter");
}

/** Starts a tree in the open project from the empty canvas (or the "New tree" composer). */
export async function startTree(page: Page, text: string) {
  if (await page.getByTestId("empty-state").isHidden()) await page.getByRole("button", { name: "New tree" }).click();
  await ask(page, text);
}
