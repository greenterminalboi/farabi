import { expect, type Page, test } from "@playwright/test";
import { resetDb } from "./helpers";

test.beforeEach(resetDb);

/** Pastes (into the textarea) or drops (onto the form) `count` real PNGs drawn on a canvas. */
async function giveImages(page: Page, how: "paste" | "drop", count: number) {
  await page.evaluate(
    async ({ how, count }) => {
      const dt = new DataTransfer();
      for (let i = 0; i < count; i++) {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 400;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = `hsl(${(i * 47) % 360} 70% 50%)`;
        ctx.fillRect(0, 0, 640, 400);
        const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
        dt.items.add(new File([blob], `shot-${how}-${i}.png`, { type: "image/png" }));
      }
      if (how === "paste") {
        const target = document.querySelector('textarea[aria-label="Feedback text"]')!;
        target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      } else {
        const form = document.querySelector(".feedback-form")!;
        form.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
        form.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      }
    },
    { how, count },
  );
}

test("paste and drop screenshots, see thumbnails, open full size", async ({ page }) => {
  await page.goto("/map");
  await page.getByRole("button", { name: /^Feedback/ }).click();
  const drawer = page.getByRole("complementary", { name: "Feedback" });
  await drawer.getByLabel("Feedback text").fill("Layout glitch on the map");

  await giveImages(page, "paste", 1);
  await giveImages(page, "drop", 1);
  await expect(drawer.getByTestId("feedback-preview")).toHaveCount(2);

  await drawer.getByRole("button", { name: "Submit feedback" }).click();
  const card = drawer.getByTestId("feedback-card").first();
  const thumbs = card.locator(".feedback-thumb img");
  await expect(thumbs).toHaveCount(2);
  await expect(drawer.getByTestId("feedback-preview")).toHaveCount(0);
  // Thumbnails are the small WebP versions made in the browser.
  await expect.poll(() => thumbs.first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(320);

  await card.locator(".feedback-thumb").first().click();
  const full = page.getByRole("dialog", { name: "Screenshot" }).locator("img");
  await expect.poll(() => full.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(640);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Screenshot" })).toHaveCount(0);
  await expect(drawer).toBeVisible(); // the first Esc only closes the lightbox
});

test("the form refuses more than 10 images", async ({ page }) => {
  await page.goto("/map");
  await page.getByRole("button", { name: /^Feedback/ }).click();
  const drawer = page.getByRole("complementary", { name: "Feedback" });
  await giveImages(page, "paste", 11);
  await expect(drawer.getByTestId("feedback-preview")).toHaveCount(10);
  await expect(drawer.getByRole("alert")).toContainText("At most 10 images per item.");
});
