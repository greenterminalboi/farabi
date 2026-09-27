import { expect, test } from "@playwright/test";
import { resetDb, selectInLastAiMessage, send, startConversation } from "./helpers";

test.beforeEach(resetDb);

test("collect a term, see it everywhere, confirm and edit it", async ({ page }) => {
  const first = await startConversation(page);
  await send(page, "Tell me about Pods");
  await selectInLastAiMessage(page, "Containers");
  await page.getByRole("button", { name: "Send to definitions" }).click();
  await expect(page.getByTestId("definitions-notice")).toContainText("Added “Containers”");
  // The captured word is now underlined in this conversation.
  await expect(page.locator(".term-mark").first()).toHaveText("Containers");

  // A second conversation: the same term, captured again, is not duplicated.
  await page.getByRole("button", { name: "New conversation" }).click();
  await page.waitForURL((u) => !u.pathname.endsWith(first));
  await send(page, "More about containers please");
  await expect(page.locator('[data-role="user"] .term-mark')).toHaveText("containers");
  await selectInLastAiMessage(page, "Containers");
  await page.getByRole("button", { name: "Send to definitions" }).click();
  await expect(page.getByTestId("definitions-notice")).toContainText("already in Definitions");

  // Hovering a marked term shows its card.
  await page.locator('[data-role="ai"] .term-mark').first().hover();
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

  // The source link opens the conversation it came from.
  await card.getByRole("link", { name: "Source" }).click();
  await page.waitForURL(new RegExp(`/n/${first}$`));
});
