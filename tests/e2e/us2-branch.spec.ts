import { expect, test } from "@playwright/test";
import { branchOn, resetDb, selectInLastAiMessage, send, startConversation } from "./helpers";

test.beforeEach(resetDb);

test("branch from a highlighted phrase", async ({ page }) => {
  const root = await startConversation(page);
  await send(page, "Tell me about Kubernetes Pods");

  const child = await branchOn(page, "Containers");
  await expect(page.getByTestId("anchor-quote")).toContainText("Containers");
  await expect(page.getByTestId("inherited-context")).toContainText("Tell me about Kubernetes Pods");
  // The branch waits for the user: no AI message on its own (FR-004).
  await expect(page.getByTestId("message")).toHaveCount(0);

  await page.goto(`/n/${root}`);
  const marker = page.locator(".marker");
  await expect(marker).toHaveCount(1);
  await expect(marker).toHaveText("Containers");
  await marker.click();
  await page.waitForURL(new RegExp(`/n/${child}$`));

  // A second, overlapping branch on the same message.
  await page.goto(`/n/${root}`);
  await selectInLastAiMessage(page, "Containers are");
  await page.getByRole("button", { name: "Branch" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith(root));
  await page.goto(`/n/${root}`);
  // "Containers" is covered by both branches, " are" by one: two layered segments.
  await expect(page.locator("[data-markers]")).toHaveCount(2);
  await expect(page.locator(".marker.depth-2")).toHaveText("Containers");
  const ids = await page.locator("[data-markers]").evaluateAll((els) =>
    new Set(els.flatMap((e) => (e as HTMLElement).dataset.markers!.split(" "))).size,
  );
  expect(ids).toBe(2);

  // Branch from the branch (third level).
  await page.goto(`/n/${child}`);
  await send(page, "What is a container runtime?");
  const grandchild = await branchOn(page, "container runtime");
  expect(grandchild).not.toBe(child);
  await expect(page.getByTestId("anchor-quote")).toContainText("container runtime");
});
