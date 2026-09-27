import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { resetDb } from "./helpers";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://farabi:farabi@127.0.0.1:5432/farabi_test";

test.beforeEach(resetDb);

test("an addressed item is confirmed, then reopened, with its full history", async ({ page }) => {
  const res = await page.request.post("/api/feedback", { multipart: { text: "Labels overlap", view: "map" } });
  const id = (await res.json()).item.id as string;
  // Claude Code's side: the real script, against the test database.
  execFileSync("npx", ["tsx", "scripts/feedback-addressed.ts", id], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, FEEDBACK_DIR: ".feedback-test" },
  });

  await page.goto("/map");
  await expect(page.getByRole("button", { name: /^Feedback/ })).toContainText("1 to confirm");
  await page.getByRole("button", { name: /^Feedback/ }).click();
  const card = page.getByTestId("feedback-card").first();
  await expect(card).toContainText("Claude Code says done — confirm?");

  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(card.locator(".feedback-state")).toHaveText("Resolved");
  await card.getByRole("button", { name: "Reopen" }).click();
  await expect(card.locator(".feedback-state")).toHaveText("Open");

  await card.getByText("History").click();
  const history = card.locator(".feedback-history li");
  await expect(history).toHaveCount(4);
  await expect(history.nth(1)).toContainText("addressed · Claude Code");
  await expect(history.nth(2)).toContainText("resolved · you");

  // An open item can be resolved directly.
  await card.getByRole("button", { name: "Resolve" }).click();
  await expect(card.locator(".feedback-state")).toHaveText("Resolved");
});
