// Colour tokens (src/shared/theme/tokens.ts): every declared foreground/background pair meets WCAG
// 2.2 contrast in light and dark, globals.css carries exactly the generated token block, and no
// hardcoded colour bypasses the tokens in the CSS or the canvas renderer.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTRAST_PAIRS,
  CSS_BEGIN,
  CSS_END,
  contrastRatio,
  type ColorRef,
  resolveRgb,
  type Scheme,
  TOKEN_NAMES,
  TOKENS,
  tokensCss,
} from "@/shared/theme/tokens";

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const label = (ref: ColorRef) => (typeof ref === "string" ? ref : `${ref.tint} over ${ref.over}`);
const SCHEMES: Scheme[] = ["light", "dark"];

describe("colour tokens", () => {
  it("define every token as #rrggbb in both schemes", () => {
    for (const scheme of SCHEMES) {
      expect(Object.keys(TOKENS[scheme]).sort()).toEqual([...TOKEN_NAMES].sort());
      for (const name of TOKEN_NAMES) expect(TOKENS[scheme][name], `${scheme} ${name}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  for (const scheme of SCHEMES) {
    it.each(CONTRAST_PAIRS.map((p) => [`${label(p.fg)} on ${label(p.bg)} (${p.use})`, p] as const))(
      `${scheme}: %s meets its minimum contrast`,
      (_name, pair) => {
        const ratio = contrastRatio(resolveRgb(scheme, pair.fg), resolveRgb(scheme, pair.bg));
        expect(ratio, `${scheme} ${label(pair.fg)} on ${label(pair.bg)}: ${ratio.toFixed(2)}:1 < ${pair.min}:1`).toBeGreaterThanOrEqual(pair.min);
      },
    );
  }

  it("computes WCAG ratios correctly (reference values)", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBe(1);
    // #767676 on white is the well-known 4.54:1.
    expect(contrastRatio([0x76, 0x76, 0x76], [255, 255, 255])).toBeCloseTo(4.54, 2);
  });

  it("globals.css carries exactly the generated block (run `npm run tokens:css` after editing tokens.ts)", () => {
    const css = read("src/app/globals.css");
    const start = css.indexOf(CSS_BEGIN);
    const end = css.indexOf(CSS_END);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(css.slice(start, end + CSS_END.length)).toBe(tokensCss());
  });

  it("no hardcoded colours outside the token block in globals.css (shadows and neutral overlays aside)", () => {
    const css = read("src/app/globals.css");
    const rest = css.slice(0, css.indexOf(CSS_BEGIN)) + css.slice(css.indexOf(CSS_END) + CSS_END.length);
    expect(rest.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
    // rgba() is allowed only for black shadows/scrims and the neutral grey hover overlay.
    for (const m of rest.matchAll(/rgba?\(([^)]*)\)/g)) expect(m[1].replace(/\s/g, ""), m[0]).toMatch(/^(0,0,0|127,127,127),[\d.]+$/);
  });

  it("the canvas renderer takes its colours from the tokens, not literals", () => {
    const src = read("src/canvas/renderer/CanvasRenderer.ts");
    expect(src.match(/0x[0-9a-f]{6}\b|#[0-9a-f]{6}\b|rgba?\(\s*\d/gi) ?? []).toEqual([]);
    expect(src).toContain('from "@/shared/theme/tokens"');
  });
});
