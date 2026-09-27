import { expect, test, type Page } from "@playwright/test";
import { branchOn, mapDebug, openMap, resetDb, send, startConversation } from "./helpers";

test.beforeEach(resetDb);

async function clickEdge(page: Page, childId: string) {
  const p = await page.evaluate((id) => window.__farabiMapEdgePoint!(id), childId);
  await page.mouse.click(p!.x, p!.y);
}

const edgeLabel = async (page: Page, childId: string) =>
  (await mapDebug(page)).edges.find((e) => e.to === childId)?.label ?? null;

test("label an edge, see it after reload, edit and clear it", async ({ page }) => {
  await startConversation(page);
  await send(page, "Tell me about Pods");
  const child = await branchOn(page, "Containers");
  await openMap(page, 2);

  await clickEdge(page, child);
  await page.getByLabel("Edge label").fill("requires understanding of");
  await page.getByLabel("Edge label").press("Enter");
  await expect.poll(() => edgeLabel(page, child)).toBe("requires understanding of");

  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForFunction(() => (window.__farabiMapDebug?.nodes.length ?? 0) === 2);
  await expect.poll(() => edgeLabel(page, child)).toBe("requires understanding of");

  await clickEdge(page, child);
  await expect(page.getByLabel("Edge label")).toHaveValue("requires understanding of");
  await page.getByLabel("Edge label").fill("builds on");
  await page.getByLabel("Edge label").press("Enter");
  await expect.poll(() => edgeLabel(page, child)).toBe("builds on");

  await clickEdge(page, child);
  await page.getByLabel("Edge label").fill("");
  await page.getByLabel("Edge label").press("Enter");
  await expect.poll(() => edgeLabel(page, child)).toBeNull();

  // Escape cancels without saving.
  await clickEdge(page, child);
  await page.getByLabel("Edge label").fill("not saved");
  await page.getByLabel("Edge label").press("Escape");
  await expect(page.getByLabel("Edge label")).toHaveCount(0);
  expect(await edgeLabel(page, child)).toBeNull();
});
