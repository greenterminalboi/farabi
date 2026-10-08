// Colour tokens the engine draws with (research R5). Names match the app's CSS custom properties
// (src/app/globals.css, and src/shared/theme/tokens.ts once the polish branch lands); the fallbacks
// equal those values, so drawings look right with or without the token file.
import type { Tone } from "./schema";

export const VIZ_TOKENS = [
  "bg",
  "surface",
  "text",
  "muted",
  "border",
  "accent",
  "accent-soft",
  "ai",
  "connector",
  "good",
  "partial",
  "bad",
] as const;

export type VizToken = (typeof VIZ_TOKENS)[number];
export type Palette = Record<VizToken, string>;
export type Scheme = "light" | "dark";

export const FALLBACK_PALETTES: Record<Scheme, Palette> = {
  light: {
    bg: "#f7f7f5",
    surface: "#ffffff",
    text: "#1d1d1f",
    muted: "#6b6b70",
    border: "#e2e2dd",
    accent: "#3b5bdb",
    "accent-soft": "#e7ecff",
    ai: "#7048e8",
    connector: "#87878c",
    good: "#268037",
    partial: "#ac5900",
    bad: "#c92a2a",
  },
  dark: {
    bg: "#161618",
    surface: "#1f1f22",
    text: "#ececec",
    muted: "#9a9aa0",
    border: "#333338",
    accent: "#748ffc",
    "accent-soft": "#252b45",
    ai: "#9b7afa",
    connector: "#707078",
    good: "#2f9e44",
    partial: "#e67700",
    bad: "#e65858",
  },
};

/** The token a tone paints with ("default" and null mean the element's normal colours). */
export function toneToken(tone: Tone | null | undefined): VizToken | null {
  switch (tone) {
    case "accent":
      return "accent";
    case "good":
      return "good";
    case "bad":
      return "bad";
    case "partial":
      return "partial";
    case "muted":
      return "muted";
    case "ai":
      return "ai";
    default:
      return null;
  }
}

/**
 * A paint value: a literal colour from `palette` (stills), or a CSS variable (on screen, so the
 * drawing follows the theme without re-rendering). `--viz-<token>` is defined on the SVG by
 * react/viz.module.css as the app's `--<token>` with this file's light or dark fallback.
 */
export function paint(token: VizToken, palette?: Palette | null): string {
  return palette ? palette[token] : `var(--viz-${token}, ${FALLBACK_PALETTES.light[token]})`;
}

