import { expect, test } from "@playwright/test";
import { branchOn, mapDebug, openMap, resetDb, send, setAiMode, startConversation } from "./helpers";

test.beforeEach(resetDb);
test.afterEach(async ({ page }) => setAiMode(page, "ok"));

test("summaries follow the conversation as it drifts", async ({ page }) => {
  await startConversation(page);
  await send(page, "Tell me about leader election");
  const branch = await branchOn(page, "Containers");
  await send(page, "Now compare Raft versus Paxos consensus");

  await openMap(page, 2);
  await expect
    .poll(async () => (await mapDebug(page)).nodes.find((n) => n.id === branch)?.label ?? "", {
      timeout: 10_000,
    })
    .toContain("mentioned here");
  const node = (await mapDebug(page)).nodes.find((n) => n.id === branch)!;
  expect(node.labelKind).toBe("summary");
});

test("typing stays responsive while summaries are slow", async ({ page }) => {
  await startConversation(page);
  await send(page, "first message");
  await setAiMode(page, "slow", 5000);
  await page.request.post(`${page.url().replace("/n/", "/api/nodes/")}/summary/refresh`, { data: {} });

  const box = page.getByLabel("Message");
  await box.click();
  // Event Timing API. Headless Chromium's software rendering adds paint delay even to a bare
  // textarea, so we measure what the app controls: handler processing time per keystroke.
  await page.evaluate(() => {
    const w = window as unknown as { __keyProcessing: number[] };
    w.__keyProcessing = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceEventTiming[]) {
        if (e.name === "keydown" || e.name === "input" || e.name === "keypress") {
          w.__keyProcessing.push(e.processingEnd - e.processingStart);
        }
      }
    }).observe({ type: "event", durationThreshold: 16, buffered: false } as PerformanceObserverInit);
  });
  await page.keyboard.type("a".repeat(50), { delay: 20 });
  await page.waitForTimeout(500);
  await expect(box).toHaveValue("a".repeat(50));
  // Only events slower than 16 ms end to end are reported; all others were fast already.
  const processing = await page.evaluate(
    () => (window as unknown as { __keyProcessing: number[] }).__keyProcessing,
  );
  console.log("slow-event processing ms:", processing.map((d) => Math.round(d)).join(","));
  const slow = processing.filter((d) => d >= 100).length;
  expect(slow / 50).toBeLessThanOrEqual(0.01);
});
