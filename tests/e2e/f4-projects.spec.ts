import { expect, type Page, test } from "@playwright/test";
import { mapDebug, openMap, resetDb, send, startConversation } from "./helpers";

test.beforeEach(resetDb);

const menuButton = (page: Page) => page.locator(".project-menu-button");
const panel = (page: Page) => page.getByRole("dialog", { name: "Projects" });

test("create, open, trash and restore projects", async ({ page }) => {
  await startConversation(page);
  await send(page, "Hello from the first project");
  await expect(menuButton(page)).toContainText("My first project");

  // Create B: it opens empty.
  await menuButton(page).click();
  await panel(page).getByRole("button", { name: "+ New project" }).click();
  await panel(page).getByLabel("Project name").fill("Physics");
  await panel(page).getByRole("button", { name: "Create" }).click();
  await expect(menuButton(page)).toContainText("Physics");
  await expect(page.getByRole("button", { name: "Start a conversation" })).toBeVisible();
  await openMap(page, 0);

  // A conversation in B, then back to A: only A's tree is on the map.
  await page.getByRole("button", { name: "New conversation" }).click();
  await page.waitForURL(/\/n\//);
  await send(page, "Hello from Physics");
  await menuButton(page).click();
  await panel(page).getByRole("button", { name: "My first project" }).click();
  await expect(menuButton(page)).toContainText("My first project");
  await expect(page.getByTestId("message").first()).toContainText("Hello from the first project");
  const t0 = Date.now();
  await openMap(page, 1);
  expect(Date.now() - t0).toBeLessThan(1000);

  // Trash A while it is open: B opens; A is listed under Trash.
  await menuButton(page).click();
  await panel(page).getByRole("button", { name: /Move “My first project” to trash/ }).click();
  await panel(page).getByRole("button", { name: "Move to trash" }).click();
  await expect(menuButton(page)).toContainText("Physics");
  await expect(page.getByTestId("message").first()).toContainText("Hello from Physics");
  await menuButton(page).click();
  await expect(panel(page).locator(".project-trashed")).toContainText("My first project");

  // Restore it and open it: everything is still there.
  await panel(page).getByRole("button", { name: "Restore" }).click();
  await expect(panel(page).locator(".project-trashed")).toHaveCount(0);
  await panel(page).getByRole("button", { name: "My first project" }).click();
  await expect(page.getByTestId("message").first()).toContainText("Hello from the first project");
  await openMap(page, 1);
  expect((await mapDebug(page)).nodes).toHaveLength(1);
});
