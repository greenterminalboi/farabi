import { expect, test, type Page } from "@playwright/test";
import {
  branchOn,
  confirmQuestion,
  resetDb,
  selectInLastAiMessage,
  send,
  setAiMode,
  startConversation,
  waitForReplyEnd,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetDb();
  await setAiMode(page, "ok"); // the fake is shared by every test in this server
});

const panel = (page: Page) => page.getByTestId("branch-panel");
const parkedItems = (page: Page) => page.getByTestId("parked-item");
const composer = (page: Page) => page.getByLabel("Message");

/**
 * Sends a message and waits for its reply's suggested spans too: they re-render the reply when
 * they arrive (Feature 5), which would drop a selection made before them.
 */
async function ask(page: Page, text: string) {
  await send(page, text);
  await suggestionsShown(page);
}

async function suggestionsShown(page: Page) {
  const lastAi = page.locator('[data-role="ai"][data-message-id]').last();
  await expect(lastAi.locator(".suggest-mark").first()).toBeVisible();
}

async function openTab(page: Page, name: "Branches" | "Parked") {
  await panel(page).getByRole("tab", { name: new RegExp(`^${name}`) }).click();
}

/** Parks `phrase` from the last AI reply, with an optional question. */
async function park(page: Page, phrase: string, question = "") {
  await selectInLastAiMessage(page, phrase);
  await page.getByRole("toolbar", { name: "Highlight actions" }).getByRole("button", { name: "Park" }).click();
  await confirmQuestion(page, question);
  await expect(page.getByTestId("parked-notice")).toBeVisible();
}

test.describe("US1 park", () => {
  test("parking keeps the user in the conversation and lists the tangent", async ({ page }) => {
    const root = await startConversation(page);
    await ask(page, "Pods");
    await composer(page).fill("half-typed thought");

    await park(page, "Containers");
    expect(page.url()).toContain(root);
    await expect(composer(page)).toHaveValue("half-typed thought");
    // "View" in the notice opens the Parked tab.
    await page.getByTestId("parked-notice").getByRole("button", { name: "View" }).click();
    await expect(parkedItems(page)).toHaveCount(1);
    await expect(parkedItems(page).first()).toContainText("Containers");
    await expect(parkedItems(page).first()).toContainText("No question");
    await expect(page.getByTestId("message")).toHaveCount(2);
  });

  test("Escape cancels without parking", async ({ page }) => {
    await startConversation(page);
    await ask(page, "Pods");
    await selectInLastAiMessage(page, "Containers");
    await page.getByRole("toolbar", { name: "Highlight actions" }).getByRole("button", { name: "Park" }).click();
    await page.getByTestId("branch-question-form").getByLabel("Your question (optional)").press("Escape");
    await expect(page.getByTestId("branch-question-form")).toHaveCount(0);
    await openTab(page, "Parked");
    await expect(page.getByTestId("parked-empty")).toBeVisible();
  });

  test("Branch preloads the composer with the typed question, else the anchor", async ({ page }) => {
    const root = await startConversation(page);
    await ask(page, "Pods");
    await branchOn(page, "Containers", "Why?");
    await expect(composer(page)).toHaveValue("Why?");
    await expect(page.getByTestId("message")).toHaveCount(0);

    await page.goto(`/n/${root}`);
    await suggestionsShown(page);
    await branchOn(page, "mentioned");
    await expect(composer(page)).toHaveValue("mentioned");
  });
});

test.describe("US2 fire", () => {
  test("an item with a question opens a branch where it's already asked", async ({ page }) => {
    const root = await startConversation(page);
    await ask(page, "Pods");
    await park(page, "Containers", "How does this scale?");
    await openTab(page, "Parked");
    await parkedItems(page).first().getByRole("button", { name: "Ask in new branch" }).click();
    await page.waitForURL((url) => !url.pathname.endsWith(root) && /\/n\//.test(url.pathname));
    await expect(page.locator('[data-role="user"]').first()).toHaveText(/How does this scale\?/);
    await waitForReplyEnd(page);
    await expect(page.locator('[data-role="ai"]').last()).toContainText("Echo: How does this scale");
    await expect(composer(page)).toHaveValue("");

    await page.goto(`/n/${root}`);
    await openTab(page, "Parked");
    await expect(page.getByTestId("parked-empty")).toBeVisible();
    await openTab(page, "Branches");
    await expect(page.getByTestId("branches-tab").getByRole("link")).toHaveCount(1);
  });

  test("an item without a question opens a branch with the anchor waiting in the composer", async ({ page }) => {
    const root = await startConversation(page);
    await ask(page, "Pods");
    await park(page, "Containers");
    await openTab(page, "Parked");
    await parkedItems(page).first().getByRole("button", { name: "Open as branch" }).click();
    await page.waitForURL((url) => !url.pathname.endsWith(root) && /\/n\//.test(url.pathname));
    await expect(composer(page)).toHaveValue("Containers");
    await expect(page.getByTestId("message")).toHaveCount(0);
  });
});

test.describe("US3 branches", () => {
  test("lists direct branches, follows the open node, and remembers being hidden", async ({ page }) => {
    const root = await startConversation(page);
    await ask(page, "Pods");
    const first = await branchOn(page, "Containers");
    await page.goto(`/n/${root}`);
    await suggestionsShown(page);
    await branchOn(page, "mentioned");
    await page.goto(`/n/${root}`);

    await openTab(page, "Branches");
    const rows = page.getByTestId("branches-tab").getByRole("link");
    await expect(rows).toHaveCount(2);
    // Newest first: the "mentioned" branch, then "Containers".
    await expect(rows.nth(1)).toContainText("Containers");
    await rows.nth(1).click();
    await page.waitForURL(new RegExp(`/n/${first}$`));
    await expect(page.getByTestId("branches-empty")).toBeVisible();
    await openTab(page, "Parked");
    await expect(page.getByTestId("parked-empty")).toBeVisible();

    await panel(page).getByRole("button", { name: "Hide branch panel" }).click();
    await page.reload();
    await expect(panel(page).getByRole("button", { name: "Show branch panel" })).toBeVisible();
    await expect(panel(page).getByRole("tab")).toHaveCount(0);
  });
});

test.describe("US4 edit and discard", () => {
  test("edits one item's question and discards another", async ({ page }) => {
    await startConversation(page);
    await ask(page, "Pods");
    await park(page, "Containers", "Original");
    await park(page, "mentioned");
    await openTab(page, "Parked");
    await expect(parkedItems(page)).toHaveCount(2);

    const edited = parkedItems(page).filter({ hasText: "Containers" });
    await edited.getByRole("button", { name: "Edit question" }).click();
    await edited.getByLabel("Question").fill("Reworded");
    await edited.getByLabel("Question").press("Enter");
    await expect(edited).toContainText("Reworded");

    await parkedItems(page).filter({ hasText: "mentioned" }).getByRole("button", { name: "Discard" }).click();
    await expect(parkedItems(page)).toHaveCount(1);
    await expect(parkedItems(page).first()).toContainText("Reworded");
    await page.reload();
    await openTab(page, "Parked");
    await expect(parkedItems(page)).toHaveCount(1);
  });
});

test("???? still quick-branches after parking (FR-016)", async ({ page }) => {
  const root = await startConversation(page);
  await ask(page, "What is a sidecar?");
  await park(page, "sidecar");
  await composer(page).pressSequentially("????");
  await page.waitForURL((url) => !url.pathname.endsWith(root) && /\/n\//.test(url.pathname));
  await expect(page.locator('[data-role="user"]').first()).toContainText("What is a sidecar?");
  await page.goto(`/n/${root}`);
  await openTab(page, "Parked");
  await expect(parkedItems(page)).toHaveCount(1);
});
