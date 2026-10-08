import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { elementsOf, focusElement, openCanvas, resetDb, setAiMode, startTree, TEST_DATABASE_URL, waitForReplyEnd } from "./helpers";

// Feature 13: lexicon chips in the composer, the card, the slot rules, and methods (quickstart).

const setAutodetect = (page: Page, value: boolean) => page.request.put("/api/settings/app", { data: { key: "lexicon_autodetect", value } });

test.beforeEach(async ({ page }) => {
  await resetDb();
  await setAiMode(page, "ok");
});

// resetDb truncates setting_changes behind the server's settings cache, so put the default back.
test.afterEach(async ({ page }) => {
  expect((await setAutodetect(page, true)).ok()).toBeTruthy();
});

async function storedText(id: string): Promise<{ text: string | null; properties: unknown }> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  const { rows } = await client.query("SELECT text, properties FROM nodes WHERE id = $1", [id]);
  await client.end();
  return rows[0];
}

test("add terms by keyboard, see what they send, and send them with the text unchanged (stories 1–3)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Pods");
  const [answer] = await elementsOf(page, "answer");
  await focusElement(page, answer.id);

  const composer = page.getByTestId("composer");
  // Open the picker, type a few letters, Enter (SC-004).
  await composer.getByTestId("term-picker-open").click();
  const picker = page.getByTestId("term-picker");
  await expect(picker.getByLabel("Search terms")).toBeFocused();
  await page.keyboard.type("dist");
  await page.keyboard.press("Enter");
  await expect(composer.getByTestId("term-chip-distill")).toBeVisible();

  // Slot rule and conflicts: shown as unavailable with the reason.
  await picker.getByLabel("Search terms").fill("comprehensive");
  const comprehensive = picker.getByTestId("term-option-comprehensive");
  await expect(comprehensive).toHaveAttribute("aria-disabled", "true");
  await expect(comprehensive).toContainText("Conflicts with Distill");
  await picker.getByLabel("Search terms").fill("summar");
  await expect(picker.getByTestId("term-option-summarize")).toContainText("Operation already set: Distill");
  await picker.getByLabel("Search terms").fill("bullet");
  await page.keyboard.press("Enter");
  await expect(composer.getByTestId("term-chip-bulleted-list")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);

  // The card shows the exact text sent (story 2).
  await composer.getByTestId("term-chip-distill").focus();
  const card = page.getByTestId("term-card");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("term-card-sent")).toContainText("Sent to the model · v1");
  await expect(card.getByTestId("term-card-sent")).toContainText("Distill: reduce the material to its single core idea");
  // Swap for a neighbour.
  await card.getByRole("button", { name: "Swap for Summarize" }).click();
  await expect(composer.getByTestId("term-chip-summarize")).toBeVisible();
  await expect(composer.getByTestId("term-chip-distill")).toHaveCount(0);

  // Send: the bubble shows the chips; the stored text is exactly what was typed.
  const box = composer.getByLabel("Message");
  await box.fill("What did the paper find?");
  await box.press("Enter");
  await expect(box).toHaveValue("");
  await expect(composer.getByTestId("term-chips")).toHaveCount(0);
  await waitForReplyEnd(page);
  const edges = await elementsOf(page, "question");
  const edge = edges[edges.length - 1];
  const bubble = page.locator(`[data-node-id="${edge.id}"]`);
  await expect(bubble.getByTestId("edge-term-summarize")).toHaveText("Summarize");
  await expect(bubble.getByTestId("edge-term-bulleted-list")).toHaveAttribute("title", /Bulleted list · Format · v1/);
  const row = await storedText(edge.id);
  expect(row.text).toBe("What did the paper find?");
  expect(row.properties).toEqual({ lexicon: [{ id: "summarize", v: 1, via: "chip" }, { id: "bulleted-list", v: 1, via: "chip" }] });
});

test("chips stay with their draft when the focus moves (FR-009)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Pods");
  await startTree(page, "Kubernetes");
  const [first, second] = await elementsOf(page, "answer");
  await focusElement(page, first.id);
  await page.getByTestId("term-picker-open").click();
  await page.keyboard.type("table");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("term-chip-table")).toBeVisible();
  await focusElement(page, second.id);
  await expect(page.getByTestId("term-chip-table")).toHaveCount(0);
  await focusElement(page, first.id);
  await expect(page.getByTestId("term-chip-table")).toBeVisible();
});

test("methods run from the function menu like Analogy (story 4)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Launch plan");
  const [answer] = await elementsOf(page, "answer");
  await focusElement(page, answer.id);
  await page.locator(`[data-node-id="${answer.id}"]`).getByRole("button", { name: "ƒ" }).click();
  const menu = page.getByTestId("function-menu");
  await expect(menu.getByRole("menuitem")).toHaveText(["Analogy", "Premortem", "Steelman", "SCQA"]);
  await menu.getByTestId("function-item-premortem").click();
  const output = page.locator(".element-text.output").first();
  await expect(output).toContainText("Premortem");
  await expect(output).toContainText("proposed");
  await expect(output.locator(".element-body")).toContainText(/Fake premortem #\d+/);
  await expect(page.locator(".element-text.function_connector")).toContainText("Premortem →");
});

test("typed lexicon words become detected chips; a dismissed one stays off; the text is sent verbatim (auto-detect)", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Pods");
  const [answer] = await elementsOf(page, "answer");
  await focusElement(page, answer.id);
  const composer = page.getByTestId("composer");
  const box = composer.getByLabel("Message");

  const text = "Summarize the paper as a table, formal but casual where it helps";
  await box.fill(text);
  await expect(composer.getByTestId("term-chip-summarize")).toHaveAttribute("data-via", "detected");
  await expect(composer.getByTestId("term-chip-summarize")).toContainText("detected");
  await expect(composer.getByTestId("term-chip-table")).toHaveAttribute("data-via", "detected");
  await expect(composer.getByTestId("term-chip-formal")).toBeVisible();
  // Two tones: the first in the text wins, the other is a suggestion that can be swapped in.
  const casual = composer.getByTestId("term-suggestion-conversational");
  await expect(casual).toContainText("conflicts with Formal");
  await casual.getByRole("button", { name: "Use Conversational instead of Formal" }).click();
  await expect(composer.getByTestId("term-chip-conversational")).toHaveAttribute("data-via", "detected");
  await expect(composer.getByTestId("term-chip-formal")).toHaveCount(0);
  await expect(composer.getByTestId("term-suggestion-formal")).toHaveCount(0);

  // Dismiss Table: it stays off although "table" is still in the text, even after more typing.
  await composer.getByRole("button", { name: "Remove Table" }).click();
  await expect(composer.getByTestId("term-chip-table")).toHaveCount(0);
  await box.press("End");
  await box.pressSequentially(" please");
  await expect(composer.getByTestId("term-chip-table")).toHaveCount(0);

  // A chip added by hand sits beside the detected ones, unmarked.
  await composer.getByTestId("term-picker-open").click();
  await page.keyboard.type("skeptic");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(composer.getByTestId("term-chip-skeptic")).toHaveAttribute("data-via", "chip");

  await box.press("Enter");
  await expect(box).toHaveValue("");
  await expect(composer.getByTestId("term-chips")).toHaveCount(0);
  await waitForReplyEnd(page);
  const edges = await elementsOf(page, "question");
  const row = await storedText(edges[edges.length - 1].id);
  expect(row.text).toBe(`${text} please`);
  expect(row.properties).toEqual({
    lexicon: [
      { id: "summarize", v: 1, via: "detected" },
      { id: "conversational", v: 1, via: "detected" },
      { id: "skeptic", v: 1, via: "chip" },
    ],
  });
});

test("with the setting off, typed words are not picked up and chips work as before", async ({ page }) => {
  await page.goto("/settings");
  const toggle = page.getByTestId("lexicon-autodetect");
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(page.getByTestId("app-settings").getByRole("status")).toHaveText("Saved");
  await expect(toggle).not.toBeChecked();

  await openCanvas(page);
  await startTree(page, "Pods");
  const [answer] = await elementsOf(page, "answer");
  await focusElement(page, answer.id);
  const composer = page.getByTestId("composer");
  const box = composer.getByLabel("Message");
  await box.fill("Summarize this as a table");
  await composer.getByTestId("term-picker-open").click();
  await page.keyboard.type("concise");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(composer.getByTestId("term-chip-concise")).toHaveAttribute("data-via", "chip");
  await expect(composer.getByTestId("term-chip-summarize")).toHaveCount(0);
  await expect(composer.getByTestId("term-chip-table")).toHaveCount(0);
  await box.press("Enter");
  await expect(box).toHaveValue("");
  await waitForReplyEnd(page);
  const edges = await elementsOf(page, "question");
  const row = await storedText(edges[edges.length - 1].id);
  expect(row.text).toBe("Summarize this as a table");
  expect(row.properties).toEqual({ lexicon: [{ id: "concise", v: 1, via: "chip" }] });
});
