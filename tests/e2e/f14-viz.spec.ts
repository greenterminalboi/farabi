// Feature 014 · the visualization engine's preview page: gallery playback, keyboard, still export,
// paste-to-render validation, generation with the fake provider, and the 200-element frame budget.
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { setAiMode } from "./helpers";

const player = (page: Page) => page.getByTestId("viz-player");
const frame = async (page: Page) => Number(await player(page).getAttribute("data-frame"));

async function open(page: Page, scene = "bubble-sort") {
  await page.goto(`/dev/viz?scene=${scene}`);
  await expect(player(page)).toBeVisible();
  await expect(page.getByTestId("viz-counter")).toContainText("Step 0 of");
}

test.afterEach(async ({ page }) => {
  await setAiMode(page, "ok");
});

test.describe("Feature 014 · visualization engine", () => {
  test("every gallery example draws, and plays, pauses and steps", async ({ page }) => {
    await open(page);
    const ids = await page.locator('[data-testid^="viz-example-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.slice("viz-example-".length)));
    expect(ids.length).toBeGreaterThanOrEqual(7);
    for (const id of ids) {
      await page.getByTestId(`viz-example-${id}`).click();
      await expect(player(page).locator("svg[role=img]")).toBeVisible();
      await expect(page.getByTestId("viz-counter")).toContainText("Step 0 of");
    }

    await page.getByTestId("viz-example-bubble-sort").click();
    await expect(page.getByTestId("viz-caption")).toHaveText("Start");
    await page.getByTestId("viz-play").click();
    await expect(player(page)).toHaveAttribute("data-playing", "true");
    await expect.poll(() => frame(page), { timeout: 5000 }).toBeGreaterThanOrEqual(2);
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(player(page)).toHaveAttribute("data-playing", "false");
    const paused = await frame(page);
    await page.waitForTimeout(1200);
    expect(await frame(page)).toBe(paused);

    await page.getByRole("button", { name: "Go to start" }).click();
    await expect.poll(() => frame(page)).toBe(0);
    await page.getByRole("button", { name: "Next step" }).click();
    await expect.poll(() => frame(page)).toBe(1);
    await expect(page.getByTestId("viz-caption")).toHaveText("Compare 5 and 2");
    await page.getByRole("button", { name: "Next step" }).click();
    await expect.poll(() => frame(page)).toBe(2);
    await expect(page.getByTestId("viz-caption")).toHaveText("5 > 2, so swap them");
    await page.getByRole("button", { name: "Previous step" }).click();
    await expect.poll(() => frame(page)).toBe(1);

    // The text alternative lists every step and summarises the current frame.
    await page.getByText("Text alternative").click();
    await expect(page.getByTestId("viz-alt")).toContainText("Step 1: Compare 5 and 2");
    await expect(page.getByTestId("viz-summary")).toContainText("comparing positions 0 and 1");
  });

  test("scrubbing shows in-between frames; the keyboard drives the player", async ({ page }) => {
    await open(page);
    const scrub = page.getByRole("slider", { name: "Position" });
    await scrub.fill("1.3");
    await expect.poll(() => frame(page)).toBe(1);
    // Part way through the first swap the cells are between their old and new places.
    const x = await page.locator("svg[role=img] rect").evaluateAll((rs) => rs.map((r) => Number(r.getAttribute("x"))));
    expect(x.some((v) => !Number.isInteger(v))).toBe(true);

    await player(page).focus();
    await page.keyboard.press("Home");
    await expect.poll(() => frame(page)).toBe(0);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => frame(page)).toBe(1);
    await page.keyboard.press("End");
    await expect.poll(() => frame(page)).toBeGreaterThan(10);
    await expect(page.getByTestId("viz-caption")).toContainText("Sorted: 1, 2, 3, 4, 5");
    await page.keyboard.press("Home");
    await page.keyboard.press(" ");
    await expect(player(page)).toHaveAttribute("data-playing", "true");
    await page.keyboard.press(" ");
    await expect(player(page)).toHaveAttribute("data-playing", "false");
  });

  test("reduced motion: steps change at once, play still advances", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await open(page);
    await page.getByRole("button", { name: "Next step" }).click();
    // No tween: the frame is whole immediately.
    expect(await page.getByRole("slider", { name: "Position" }).inputValue()).toBe("1");
    await page.getByTestId("viz-play").click();
    await expect.poll(() => frame(page), { timeout: 4000 }).toBeGreaterThanOrEqual(2);
    await context.close();
  });

  test("exports the current frame as SVG and PNG", async ({ page }) => {
    await open(page, "contradiction");
    await page.getByRole("button", { name: "Next step" }).click();
    await page.getByRole("button", { name: "Next step" }).click();
    await expect.poll(() => frame(page)).toBe(2);

    const [svgDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export SVG" }).click()]);
    expect(svgDownload.suggestedFilename()).toBe("caching-always-or-never-step-2.svg");
    const svg = readFileSync((await svgDownload.path())!, "utf8");
    expect(svg).toContain('role="img"');
    expect(svg).toContain("Cache every API response");
    expect(svg).toContain("Never show data older");
    expect(svg).not.toContain("var(--");

    const [pngDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export PNG" }).click()]);
    expect(pngDownload.suggestedFilename()).toBe("caching-always-or-never-step-2.png");
    const png = readFileSync((await pngDownload.path())!);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    // 2× the scene size: width and height are big-endian at bytes 16 and 20.
    expect(png.readUInt32BE(16)).toBe(1600);
    await expect(player(page).getByRole("alert")).toHaveCount(0);
  });

  test("a pasted scene renders; an invalid one lists located problems and draws nothing new", async ({ page }) => {
    await open(page);
    const scene = {
      version: 1,
      title: "Pasted scene",
      description: "A pasted array.",
      family: "algorithm",
      origin: "user-authored",
      elements: [{ type: "array", id: "a", x: 20, y: 20, values: [1, 2] }],
      steps: [{ caption: "Swap", actions: [{ op: "swap", target: "a", i: 0, j: 1 }] }],
    };
    await page.getByTestId("viz-json").fill(JSON.stringify(scene));
    await page.getByTestId("viz-render").click();
    await expect(player(page).getByRole("heading", { name: "Pasted scene" })).toBeVisible();

    await page.getByTestId("viz-json").fill(JSON.stringify({ ...scene, title: "Broken", steps: [{ caption: "Bad", actions: [{ op: "swap", target: "a", i: 0, j: 5 }] }] }));
    await page.getByTestId("viz-render").click();
    await expect(page.getByTestId("viz-problems")).toContainText('steps.0.actions.0.j: "a" has no cell 5');
    await expect(player(page).getByRole("heading", { name: "Pasted scene" })).toBeVisible();
  });

  test("generates an AI-suggested scene from text with the fake provider, and fails cleanly", async ({ page }) => {
    await open(page);
    await page.getByTestId("viz-source").fill("Remote work raises productivity.\nRemote work lowers productivity.");
    await page.getByTestId("viz-generate").click();
    await expect(player(page).getByRole("heading", { name: "Two statements from the text" })).toBeVisible();
    await expect(player(page).getByText("AI-suggested", { exact: true }).first()).toBeVisible();
    await expect(player(page).locator("svg[role=img] title")).toHaveText(/\(AI-suggested\)$/);
    await page.getByTestId("viz-play").click();
    await expect.poll(() => frame(page), { timeout: 5000 }).toBeGreaterThanOrEqual(1);

    await setAiMode(page, "fail");
    await page.getByTestId("viz-source").fill("def f(x):\n    return x");
    await page.getByTestId("viz-generate").click();
    await expect(page.getByTestId("viz-gen-error")).toHaveText("The AI couldn't produce a usable visualization. Nothing was created. Try again.");
    // The previous scene stays; no new one appeared.
    await expect(player(page).getByRole("heading", { name: "Two statements from the text" })).toBeVisible();
  });
});
