// Browser-only stills (FR-011, research R8): the current theme read from the app's CSS custom
// properties, then the same renderSvg the server uses. PNG draws that SVG onto a 2D canvas; there is
// no foreignObject, so WebKit doesn't taint the canvas.
import { renderSvg } from "../svg";
import { sceneSize } from "../layout";
import type { Scene } from "../schema";
import { FALLBACK_PALETTES, type Palette, VIZ_TOKENS } from "../theme";

export function currentScheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  const forced = document.documentElement.dataset.theme;
  if (forced === "dark" || forced === "light") return forced;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The theme in effect as literal colours; missing tokens fall back to the engine's values. */
export function readPalette(): Palette {
  const fallback = FALLBACK_PALETTES[currentScheme()];
  if (typeof window === "undefined") return fallback;
  const css = getComputedStyle(document.documentElement);
  const out = { ...fallback };
  for (const token of VIZ_TOKENS) {
    const value = css.getPropertyValue(`--${token}`).trim();
    if (value) out[token] = value;
  }
  return out;
}

export function exportSvgString(scene: Scene, t: number, palette: Palette = readPalette()): string {
  return renderSvg(scene, t, { palette, idPrefix: "viz-export" });
}

export function stillFilename(scene: Scene, t: number, ext: "svg" | "png"): string {
  const slug = scene.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "visualization";
  const frame = Number.isInteger(t) ? `step-${t}` : `step-${t.toFixed(2)}`;
  return `${slug}-${frame}.${ext}`;
}

/** A PNG of the SVG at `scale`× (default 2). */
export async function pngBlob(scene: Scene, t: number, scale = 2, palette: Palette = readPalette()): Promise<Blob> {
  const svg = exportSvgString(scene, t, palette);
  const { width, height } = sceneSize(scene);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("The SVG couldn't be drawn as an image"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D canvas available");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Saves a blob through an `<a download>` link. Works in browsers; the desktop shell (WKWebView) may
 * need its own save path at integration time (contracts/engine-api.md).
 */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function exportSvg(scene: Scene, t: number, filename = stillFilename(scene, t, "svg")): void {
  download(new Blob([exportSvgString(scene, t)], { type: "image/svg+xml;charset=utf-8" }), filename);
}

export async function exportPng(scene: Scene, t: number, filename = stillFilename(scene, t, "png"), scale = 2): Promise<void> {
  download(await pngBlob(scene, t, scale), filename);
}
