import { expect, test } from "@playwright/test";
import { branchOn, mapDebug, openMap, resetDb, send, startConversation } from "./helpers";

test.beforeEach(resetDb);

test("map shows the forest and growth never moves other trees", async ({ page }) => {
  const root1 = await startConversation(page);
  await send(page, "Tell me about Pods");
  const b1 = await branchOn(page, "Containers");
  await send(page, "Explain container images");
  await branchOn(page, "container images");
  await page.goto(`/n/${root1}`);
  await branchOn(page, "mentioned");

  await page.getByRole("button", { name: "New conversation" }).click();
  await page.waitForURL((u) => !u.pathname.endsWith(root1));

  await openMap(page, 5);
  const map = await mapDebug(page);
  expect(map.edges).toHaveLength(3);
  expect(map.nodes.filter((n) => n.isRoot)).toHaveLength(2);
  const [t1, t2] = Object.values(map.treeBoxes);
  const disjoint = t1.maxX <= t2.minX || t2.maxX <= t1.minX || t1.maxY <= t2.minY || t2.maxY <= t1.minY;
  expect(disjoint).toBe(true);
  expect(map.nodes.every((n) => n.labelKind === "placeholder" || n.labelKind === "summary")).toBe(true);

  const tree1 = map.nodes.find((n) => n.id === root1)!.treeId;
  const otherBefore = map.nodes.filter((n) => n.treeId !== tree1).map((n) => [n.id, n.x, n.y]);

  await page.goto(`/n/${b1}`);
  await branchOn(page, "Containers are");
  await openMap(page, 6);
  const after = await mapDebug(page);
  const otherAfter = after.nodes.filter((n) => n.treeId !== tree1).map((n) => [n.id, n.x, n.y]);
  expect(otherAfter).toEqual(otherBefore);
});
