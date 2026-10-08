// Farabi's colour tokens: the ONE source of truth for both the CSS custom properties in
// src/app/globals.css (the block between `tokens:begin` and `tokens:end` is generated from this
// file by `npm run tokens:css`) and the canvas renderer (src/canvas/renderer), which imports it.
// Each meaning token means one thing (colour research, 2026-10-07): a new meaning gets a shape,
// line style or word before it gets a hue, and colour never carries a meaning alone.
// Every foreground/background pair the UI draws is declared in CONTRAST_PAIRS and checked by
// tests/unit/theme-tokens.test.ts: text 4.5:1, UI components and focus indicators 3:1 (WCAG 2.2
// 1.4.3, 1.4.11), in light and dark.

export type Scheme = "light" | "dark";

export const TOKEN_NAMES = [
  // Surfaces and text
  "bg", // page and canvas background
  "surface", // cards, frames, panels
  "region", // the faint region behind each tree on the canvas
  "text",
  "muted", // secondary text
  "border", // decorative borders between areas (not required to meet 3:1)
  "frame-border", // element frame outlines on the canvas, minimap border
  // Meaning tokens
  "accent", // you can act on this, or it is selected
  "accent-soft", // accent tint behind accent text; question bubbles
  "bubble-border", // question bubble outline on the canvas
  "on-accent", // text on an accent fill (primary buttons, pressed chips)
  "ai", // AI made this
  "ai-soft", // AI output fill on the canvas
  "on-ai", // text on an AI fill (confirmed review chip)
  "focus", // the element you are on (canvas focus ring, minimap viewport)
  "connector", // lines between elements
  "marker-hue", // branch markers: the anchor dot, drill frames; tints come from MARKER_ALPHA
  "good", // solved, confirmed
  "partial", // partly solved
  "bad", // failed, not solved, error
  "on-bad", // text on a bad fill (danger buttons)
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];
export type Palette = Record<TokenName, string>;

export const TOKENS: Record<Scheme, Palette> = {
  light: {
    bg: "#f7f7f5",
    surface: "#ffffff",
    region: "#efefeb",
    text: "#1d1d1f",
    muted: "#6b6b70",
    border: "#e2e2dd",
    "frame-border": "#d8d8d2",
    accent: "#3b5bdb",
    "accent-soft": "#e7ecff",
    "bubble-border": "#c5cff5",
    "on-accent": "#ffffff",
    ai: "#7048e8",
    "ai-soft": "#f4f0fe",
    "on-ai": "#ffffff",
    focus: "#b17d04",
    connector: "#87878c",
    "marker-hue": "#fab005",
    good: "#268037",
    partial: "#ac5900",
    bad: "#c92a2a",
    "on-bad": "#ffffff",
  },
  dark: {
    bg: "#161618",
    surface: "#1f1f22",
    region: "#1c1c1f",
    text: "#ececec",
    muted: "#9a9aa0",
    border: "#333338",
    "frame-border": "#38383e",
    accent: "#748ffc",
    "accent-soft": "#252b45",
    "bubble-border": "#39426a",
    "on-accent": "#161618",
    ai: "#9b7afa",
    "ai-soft": "#2a2340",
    "on-ai": "#161618",
    focus: "#fab005",
    connector: "#707078",
    "marker-hue": "#fab005",
    good: "#2f9e44",
    partial: "#e67700",
    bad: "#e65858",
    "on-bad": "#161618",
  },
};

/** Branch-marker tints behind text: `marker-hue` at these opacities, as --marker / --marker-strong. */
export const MARKER_ALPHA: Record<Scheme, { marker: number; "marker-strong": number }> = {
  light: { marker: 0.35, "marker-strong": 0.6 },
  dark: { marker: 0.25, "marker-strong": 0.45 },
};

/** A token, or a marker tint composited over a token (what the eye sees behind marked text). */
export type ColorRef = TokenName | { tint: keyof (typeof MARKER_ALPHA)["light"]; over: TokenName };

export type ContrastPair = { fg: ColorRef; bg: ColorRef; min: 4.5 | 3; use: string };

const TEXT = 4.5;
const UI = 3;

/** Every foreground/background pair the UI relies on, checked in both schemes. */
export const CONTRAST_PAIRS: ContrastPair[] = [
  { fg: "text", bg: "bg", min: TEXT, use: "body text" },
  { fg: "text", bg: "surface", min: TEXT, use: "text in cards and frames" },
  { fg: "text", bg: "accent-soft", min: TEXT, use: "question bubble text" },
  { fg: "text", bg: "ai-soft", min: TEXT, use: "AI output text" },
  { fg: "bg", bg: "text", min: TEXT, use: "toast, highlight toolbar, Stop button" },
  { fg: "muted", bg: "bg", min: TEXT, use: "secondary text" },
  { fg: "muted", bg: "surface", min: TEXT, use: "secondary text in cards, element headers" },
  { fg: "muted", bg: "accent-soft", min: TEXT, use: "question bubble footer" },
  { fg: "muted", bg: "ai-soft", min: TEXT, use: "AI output header" },
  { fg: "accent", bg: "surface", min: TEXT, use: "links, selected tabs, settings status" },
  { fg: "accent", bg: "bg", min: TEXT, use: "links on the page background" },
  { fg: "accent", bg: "accent-soft", min: TEXT, use: "current view toggle, counts, lexicon chips" },
  { fg: "on-accent", bg: "accent", min: TEXT, use: "primary button, send, pressed chip" },
  { fg: "ai", bg: "surface", min: TEXT, use: "AI tag, draft badge, function connector label" },
  { fg: "ai", bg: "bg", min: TEXT, use: "AI text on the page background" },
  { fg: "ai", bg: "ai-soft", min: TEXT, use: "AI tag on an output" },
  { fg: "on-ai", bg: "ai", min: TEXT, use: "confirmed review chip" },
  { fg: "good", bg: "surface", min: TEXT, use: "solved / confirmed text" },
  { fg: "good", bg: "bg", min: TEXT, use: "solved text on the page background" },
  { fg: "partial", bg: "surface", min: TEXT, use: "partly solved text" },
  { fg: "partial", bg: "bg", min: TEXT, use: "partly solved text on the page background" },
  { fg: "bad", bg: "surface", min: TEXT, use: "error text, not solved" },
  { fg: "bad", bg: "bg", min: TEXT, use: "error text on the page background" },
  { fg: "on-bad", bg: "bad", min: TEXT, use: "danger button" },
  { fg: "text", bg: { tint: "marker", over: "surface" }, min: TEXT, use: "marked text" },
  { fg: "text", bg: { tint: "marker-strong", over: "surface" }, min: TEXT, use: "nested marked text" },
  { fg: "focus", bg: "bg", min: UI, use: "canvas focus ring" },
  { fg: "focus", bg: "region", min: UI, use: "canvas focus ring inside a tree region" },
  { fg: "focus", bg: "surface", min: UI, use: "minimap viewport" },
  { fg: "connector", bg: "bg", min: UI, use: "connectors" },
  { fg: "connector", bg: "region", min: UI, use: "connectors inside a tree region" },
  { fg: "ai", bg: "region", min: UI, use: "AI connectors and output outlines" },
  { fg: "bad", bg: "region", min: UI, use: "failed frame outline" },
  { fg: "accent", bg: "surface", min: UI, use: "focus outlines (focus-visible) on controls" },
];

// ---- Colour arithmetic (WCAG 2.x relative luminance) ----

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 0xrrggbb, for PixiJS. */
export function hexToNumber(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (r << 16) | (g << 8) | b;
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function mix(fg: string, alpha: number, bg: string): [number, number, number] {
  const f = hexToRgb(fg);
  const b = hexToRgb(bg);
  return [0, 1, 2].map((i) => f[i] * alpha + b[i] * (1 - alpha)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function resolveRgb(scheme: Scheme, ref: ColorRef): [number, number, number] {
  const p = TOKENS[scheme];
  if (typeof ref === "string") return hexToRgb(p[ref]);
  return mix(p["marker-hue"], MARKER_ALPHA[scheme][ref.tint], p[ref.over]);
}

export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---- CSS generation ----

export const CSS_BEGIN = "/* tokens:begin: generated from src/shared/theme/tokens.ts by `npm run tokens:css`; do not edit by hand */";
export const CSS_END = "/* tokens:end */";

function declarations(scheme: Scheme, indent: string): string {
  const p = TOKENS[scheme];
  const lines = TOKEN_NAMES.map((name) => `${indent}--${name}: ${p[name]};`);
  for (const [name, alpha] of Object.entries(MARKER_ALPHA[scheme])) lines.push(`${indent}--${name}: ${rgba(p["marker-hue"], alpha)};`);
  return lines.join("\n");
}

/** The generated block of globals.css, markers included. */
export function tokensCss(): string {
  return [
    CSS_BEGIN,
    ":root {",
    declarations("light", "  "),
    "}",
    "",
    "@media (prefers-color-scheme: dark) {",
    "  :root {",
    declarations("dark", "    "),
    "  }",
    "}",
    CSS_END,
  ].join("\n");
}
