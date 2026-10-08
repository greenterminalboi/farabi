import { expect, test } from "@playwright/test";
import { apiAttempt, apiDrill, currentProjectId, openDrill } from "./drill-helpers";
import { ask, focusElement, openCanvas, resetDb, setAiMode, startTree } from "./helpers";

// Feature 12, story 6: ground a drill in a conversation and drill on from it.

test.beforeEach(async ({ page }) => {
  await resetDb();
  await setAiMode(page, "ok");
});

test("attach from the canvas, complete the ladder, pick an offer and start a linked drill", async ({ page }) => {
  await openCanvas(page);
  await startTree(page, "Hash tables and collisions");
  await ask(page, "And open addressing?");
  const { drill } = await apiDrill(page, "Regex", { rungs: ["Literals", "Classes"], roundSize: 1 });
  const problem = drill.rounds[0].problems[0];
  const judged = await apiAttempt(page, problem.element.id, "nope");
  await page.request.post(`/api/nodes/${judged.drill.rounds[0].problems[0].attempts[0].verdict.id}/ask?wait=1`, {
    data: { content: "Why do classes match one character?" },
  });

  await openDrill(page, drill.drillId);
  await page.getByRole("button", { name: /Attached/ }).click();
  await page.getByRole("button", { name: "Attach from canvas" }).click();
  await expect(page.getByTestId("drill-attach-banner")).toBeVisible();
  await page.waitForFunction(() => typeof window.__farabiCanvasDebug === "function");
  const canvas = await (await page.request.get(`/api/canvas?projectId=${await currentProjectId(page)}`)).json();
  const target = canvas.elements.find((e: { kind: string; text: string | null }) => e.kind === "answer" && e.text?.includes("open addressing"));
  await focusElement(page, target.id);
  await expect(page.getByTestId("drill-attach-banner")).toContainText("open addressing");
  await page.getByTestId("drill-attach-banner").getByRole("button", { name: "Attach" }).click();
  await page.waitForURL(new RegExp(`/drill/${drill.drillId}`));
  await page.getByRole("button", { name: /Attached \(1\)/ }).click();
  await expect(page.getByTestId("drill-attachments")).toContainText("open addressing");

  // Mark every rung solid by hand, then end the round.
  for (const i of [0, 1]) await page.getByTestId(`drill-rung-${i}`).getByRole("combobox").selectOption("s:solid");
  await page.getByTestId("drill-end-round").click();
  await expect(page.getByTestId("drill-complete")).toContainText("Ladder complete");
  await expect(page.getByTestId("drill-offer-0")).toContainText("Why do classes");
  await expect(page.getByTestId("drill-offer-1")).toContainText("Hash tables");

  await page.getByTestId("drill-offer-0").getByRole("button", { name: "Drill this" }).click();
  await expect(page.getByTestId("drill-domain")).toHaveValue(/Drill on: Why do classes/);
  await page.getByRole("button", { name: "Create drill" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/drill/") && !url.pathname.endsWith(drill.drillId));
  await expect(page.locator(".drill-header")).toContainText("from Regex");

  await page.goto(`/drill/${drill.drillId}`);
  await page.getByTestId("drill-complete").getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByTestId("drill-offer-0")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("drill-offer-0")).toHaveCount(0);
  await expect(page.getByTestId("drill-complete")).toContainText("Ladder complete");
});
