import { expect, test, type Page } from "@playwright/test";
import { mapDebug, openMap, resetDb, send, setAiMode, startConversation } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetDb();
  await setAiMode(page, "ok");
});

/** A conversation with one reply, waiting until its summary label is shown. */
async function summarizedConversation(page: Page, text = "Tell me about Pods"): Promise<string> {
  const nodeId = await startConversation(page);
  await send(page, text);
  await expect(page.getByTestId("node-header").locator(".summary")).toBeVisible({ timeout: 10_000 });
  return nodeId;
}

/** Runs Analogy from the chat header and returns the new output's id. */
async function runAnalogyFromChat(page: Page): Promise<string> {
  await page.getByTestId("node-functions-button").click();
  await page.getByTestId("function-item-analogy").click();
  const link = page.getByTestId("function-open-output");
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  await page.keyboard.press("Escape");
  return href!.split("/n/")[1];
}

async function clickNode(page: Page, nodeId: string) {
  const p = await page.evaluate((id) => window.__farabiMapScreenPoint!(id), nodeId);
  await page.mouse.click(p!.x, p!.y);
}

async function openNode(page: Page, nodeId: string) {
  const p = await page.evaluate((id) => window.__farabiMapScreenPoint!(id), nodeId);
  await page.mouse.dblclick(p!.x, p!.y);
  await page.waitForURL(new RegExp(`/n/${nodeId}$`));
}

const outputOf = async (page: Page, id: string) => (await mapDebug(page)).nodes.find((n) => n.id === id);

test.describe("US1 run", () => {
  test("Analogy waits for a summary, then appears beside its source with a pipe", async ({ page }) => {
    await startConversation(page);
    await page.getByTestId("node-functions-button").click();
    await expect(page.getByTestId("function-item-analogy")).toBeDisabled();
    await expect(page.getByTestId("function-unavailable-reason")).toContainText("no summary yet");
    await page.keyboard.press("Escape");

    await send(page, "Tell me about Pods");
    await expect(page.getByTestId("node-header").locator(".summary")).toBeVisible({ timeout: 10_000 });
    const source = page.url().split("/n/")[1];
    const output = await runAnalogyFromChat(page);

    await openMap(page, 2);
    const box = await outputOf(page, output);
    expect(box).toMatchObject({ kind: "analogy", review: "proposed", isRoot: false });
    expect(box!.label).toMatch(/^Fake analogy/);
    const src = (await mapDebug(page)).nodes.find((n) => n.id === source)!;
    expect(box!.x).toBeGreaterThan(src.x);
    expect((await mapDebug(page)).pipes).toEqual([expect.objectContaining({ from: source, to: output, state: "proposed" })]);

    // From the map: select the source, run again.
    await clickNode(page, source);
    await page.getByTestId("map-functions-button").click();
    await page.getByTestId("function-item-analogy").click();
    await expect.poll(async () => (await mapDebug(page)).nodes.length).toBe(3);
    expect((await mapDebug(page)).pipes).toHaveLength(2);
  });

  test("a failed run creates nothing and can be retried", async ({ page }) => {
    await summarizedConversation(page);
    await setAiMode(page, "fail");
    await page.getByTestId("node-functions-button").click();
    await page.getByTestId("function-item-analogy").click();
    await expect(page.getByTestId("function-error")).toBeVisible();
    await setAiMode(page, "ok");
    await page.getByTestId("function-retry").click();
    await expect(page.getByTestId("function-open-output")).toBeVisible();
    await page.keyboard.press("Escape");
    await openMap(page, 2);
  });
});

async function clickPipe(page: Page, pipeId: string) {
  const p = await page.evaluate((id) => window.__farabiMapPipePoint!(id), pipeId);
  await page.mouse.click(p!.x, p!.y);
}

test.describe("US2 views", () => {
  test("an analogy opens beside its input; a pipe shows its details; conversations open chat", async ({ page }) => {
    const source = await summarizedConversation(page);
    const output = await runAnalogyFromChat(page);
    await openMap(page, 2);

    await openNode(page, output);
    await expect(page.getByTestId("output-text")).toHaveText(/^Fake analogy/);
    await expect(page.getByTestId("output-state")).toHaveText("Proposed");
    await expect(page.getByTestId("input-conversation").getByTestId("message")).toHaveCount(2);
    await expect(page.getByTestId("open-input")).toHaveAttribute("href", `/n/${source}`);
    // Read-only: nothing in the input can anchor a branch (FR-005).
    await expect(page.locator("[data-testid=input-conversation] [data-message-id]")).toHaveCount(0);

    await page.getByRole("link", { name: "Map" }).click();
    await page.waitForURL(/\/map$/);
    await openNode(page, source);
    await expect(page.getByTestId("node-header")).toBeVisible();
    await expect(page.locator(".branch-row")).toHaveCount(0);

    await page.getByRole("link", { name: "Map" }).click();
    await page.waitForURL(/\/map$/);
    const pipe = (await mapDebug(page)).pipes[0];
    await clickPipe(page, pipe.id);
    const card = page.getByTestId("pipe-card");
    await expect(card.getByTestId("pipe-function")).toHaveText("Analogy v1");
    await expect(card.getByTestId("pipe-reads")).toHaveText("reads the summary");
    await expect(card.getByTestId("pipe-state")).toHaveText("Proposed");
    await expect(card.getByTestId("pipe-versions")).toHaveText("1 version");
    expect(page.url()).toMatch(/\/map$/);
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
  });
});

test.describe("US3 review", () => {
  test("confirm makes it solid; reject hides it until Show rejected", async ({ page }) => {
    await summarizedConversation(page);
    const kept = await runAnalogyFromChat(page);
    const dropped = await runAnalogyFromChat(page);

    await page.goto(`/n/${kept}`);
    await page.getByTestId("confirm-output").click();
    await expect(page.getByTestId("output-state")).toHaveText("Confirmed");

    await page.goto(`/n/${dropped}`);
    await page.getByTestId("reject-output").click();
    await expect(page.getByTestId("output-state")).toHaveText("Rejected");

    await openMap(page, 2);
    expect(await outputOf(page, kept)).toMatchObject({ review: "confirmed" });
    expect(await outputOf(page, dropped)).toBeUndefined();
    const pipes = (await mapDebug(page)).pipes;
    expect(pipes).toEqual([expect.objectContaining({ to: kept, state: "confirmed" })]);

    await page.getByTestId("map-show-rejected").click();
    await expect.poll(async () => (await mapDebug(page)).nodes.length).toBe(3);
    expect(await outputOf(page, dropped)).toMatchObject({ review: "rejected" });
    await page.getByTestId("map-show-rejected").click();
    await expect.poll(async () => (await mapDebug(page)).nodes.length).toBe(2);
  });
});

test.describe("US4 staleness", () => {
  test("a stale badge appears after the source moves on; Regenerate keeps the confirmed text", async ({ page }) => {
    const source = await summarizedConversation(page);
    const output = await runAnalogyFromChat(page);
    await page.goto(`/n/${output}`);
    await page.getByTestId("confirm-output").click();
    await expect(page.getByTestId("output-state")).toHaveText("Confirmed");
    const confirmedText = await page.getByTestId("output-text").textContent();
    await expect(page.getByTestId("stale-badge")).toHaveCount(0);

    await page.goto(`/n/${source}`);
    const label = await page.getByTestId("node-header").locator(".summary").textContent();
    await send(page, "What about Deployments");
    await expect(page.getByTestId("node-header").locator(".summary")).not.toHaveText(label!, { timeout: 10_000 });

    await openMap(page, 2);
    await expect.poll(async () => (await outputOf(page, output))?.stale).toBe(true);
    const pill = await page.evaluate((id) => window.__farabiMapBadgePoint!(id), output);
    await page.mouse.click(pill!.x, pill!.y);
    await expect.poll(async () => (await outputOf(page, output))?.pendingDraft).toBe(true);
    expect((await outputOf(page, output))?.stale).toBe(false);

    await page.goto(`/n/${output}`);
    await expect(page.getByTestId("output-text")).toHaveText(confirmedText!);
    await expect(page.getByTestId("draft-panel")).toBeVisible();
    await page.getByTestId("confirm-draft").click();
    await expect(page.getByTestId("draft-panel")).toHaveCount(0);
    await expect(page.getByTestId("output-text")).not.toHaveText(confirmedText!);
    await page.getByTestId("versions-list").locator("summary").click();
    await expect(page.getByTestId("version-item")).toHaveCount(2);
  });
});

test.describe("US5 settings", () => {
  test("kind settings live on the Settings page; one analogy can override them", async ({ page }) => {
    await summarizedConversation(page);
    const output = await runAnalogyFromChat(page);

    await page.goto("/settings");
    const length = page.getByTestId("kind-setting-analogy-length");
    await expect(length).toHaveValue("short");
    await length.selectOption("one_line");
    await expect(page.getByTestId("kind-settings-saved")).toBeVisible();

    await page.goto(`/n/${output}`);
    await page.getByTestId("node-settings").locator("summary").click();
    const override = page.getByTestId("node-setting-length");
    await expect(override.locator("option").first()).toHaveText("Use default (One sentence)");
    await override.selectOption("paragraph");
    await expect(page.getByTestId("node-setting-override-note-length")).toBeVisible();
    await override.selectOption("");
    await expect(page.getByTestId("node-setting-override-note-length")).toHaveCount(0);
  });
});
