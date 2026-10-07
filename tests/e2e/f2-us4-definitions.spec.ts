import { expect, test } from "@playwright/test";
import { elementsOf, openCanvas, resetDb, selectInElement, startTree } from "./helpers";

// Feature 2 definitions on the canvas (Feature 10, FR-055, T093).

test.beforeEach(resetDb);

test("collect a term, see it everywhere, confirm and edit it", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Tell me about Pods");
  const [first] = await elementsOf(page, "answer");
  await selectInElement(page, first.id, "Containers");
  await page.getByRole("toolbar", { name: "Highlight actions" }).getByRole("button", { name: "Define" }).click();
  await expect(page.getByTestId("definitions-notice")).toContainText("Added “Containers”");
  // The captured word is now underlined on the canvas.
  await expect(page.locator(`[data-node-id="${first.id}"] .term-mark`).first()).toHaveText("Containers");

  // A second tree: the same term, captured again, is not duplicated.
  await startTree(page, "More about containers please");
  await expect(page.locator(".element-text.question .term-mark").last()).toHaveText("containers");
  const second = (await elementsOf(page, "answer")).find((a) => a.id !== first.id)!;
  await selectInElement(page, second.id, "Containers");
  await page.getByRole("toolbar", { name: "Highlight actions" }).getByRole("button", { name: "Define" }).click();
  await expect(page.getByTestId("definitions-notice")).toContainText("already in Definitions");

  // Hovering a marked term shows its card.
  await page.locator(`[data-node-id="${second.id}"] .term-mark`).first().hover();
  await expect(page.getByTestId("term-card")).toContainText("General meaning of Containers");

  // The tab lists it once, as a draft, then confirm and edit.
  await page.getByRole("link", { name: "Definitions", exact: true }).click();
  await page.waitForURL(/\/definitions$/);
  await expect(page.getByTestId("definition-card")).toHaveCount(1);
  const card = page.getByTestId("definition-card");
  await expect(card).toContainText("Draft");
  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(card).toContainText("Confirmed");
  await card.getByRole("button", { name: "Edit" }).click();
  await card.getByLabel("General").fill("Packaged processes that share a kernel.");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card).toContainText("Packaged processes that share a kernel.");
  await card.getByRole("button", { name: "History" }).click();
  await expect(card.locator(".definition-history li")).toHaveCount(3);

  // The source link focuses the text it came from.
  await card.getByRole("link", { name: "Source" }).click();
  await page.waitForURL(new RegExp(`focus=${first.id}`));
  await expect.poll(async () => (await elementsOf(page, "answer")).find((a) => a.id === first.id)?.focused).toBe(true);
});
