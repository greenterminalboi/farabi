// Text estimates and shapes (research R6): fixed character widths, so layout is identical in Node
// and every browser, and nothing measures fonts.
export const MONO_EM = 0.6;
export const PROSE_EM = 0.56;
export const FONT_SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
export const FONT_MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export function textWidth(text: string, size: number, mono = false): number {
  return [...text].length * size * (mono ? MONO_EM : PROSE_EM);
}

export function ellipsize(text: string, maxWidth: number, size: number, mono = false): string {
  if (textWidth(text, size, mono) <= maxWidth) return text;
  const chars = [...text];
  const fit = Math.max(1, Math.floor(maxWidth / (size * (mono ? MONO_EM : PROSE_EM))) - 1);
  return chars.slice(0, fit).join("").trimEnd() + "…";
}

/** Word-wraps to `maxWidth`; words longer than a line are broken. At most `maxLines`, the last ellipsized. */
export function wrap(text: string, maxWidth: number, size: number, maxLines = 6): string[] {
  const perLine = Math.max(4, Math.floor(maxWidth / (size * PROSE_EM)));
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (let word of paragraph.split(/\s+/).filter(Boolean)) {
      while ([...word].length > perLine) {
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push([...word].slice(0, perLine).join(""));
        word = [...word].slice(perLine).join("");
      }
      const next = line ? `${line} ${word}` : word;
      if ([...next].length > perLine) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = ellipsize(`${kept[maxLines - 1]} ${lines[maxLines]}`, maxWidth, size);
    return kept;
  }
  return lines;
}

export type Rect = { x: number; y: number; w: number; h: number; round?: boolean };

export const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Where the line from r's centre towards (tx, ty) leaves r (a rectangle, or an ellipse when round). */
export function clipToRect(r: Rect, tx: number, ty: number, gap = 2): { x: number; y: number } {
  const c = center(r);
  const dx = tx - c.x;
  const dy = ty - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = r.w / 2 + gap;
  const hh = r.h / 2 + gap;
  let s: number;
  if (r.round) s = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
  else s = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
  return { x: c.x + dx * s, y: c.y + dy * s };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Path data for a link: the line (straight, or zigzag for conflicts) and its end marks. */
export function linkPaths(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  kind: "plain" | "supports" | "attacks" | "conflicts",
  directed: boolean,
): { line: string; heads: string[]; bars: string[] } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const head = (x: number, y: number, dirx: number, diry: number) => {
    const size = 9;
    const bx = x - dirx * size;
    const by = y - diry * size;
    return `M${r2(x)} ${r2(y)}L${r2(bx + -diry * size * 0.5)} ${r2(by + dirx * size * 0.5)}L${r2(bx - -diry * size * 0.5)} ${r2(by - dirx * size * 0.5)}Z`;
  };
  let line: string;
  if (kind === "conflicts" && len > 40) {
    // Zigzag between 25% and 75% of the length, straight at both ends.
    const pts: string[] = [`M${r2(x1)} ${r2(y1)}`];
    const a = 0.25 * len;
    const b = 0.75 * len;
    const n = Math.max(4, Math.round((b - a) / 10));
    pts.push(`L${r2(x1 + ux * a)} ${r2(y1 + uy * a)}`);
    for (let i = 1; i < n; i++) {
      const d = a + ((b - a) * i) / n;
      const off = (i % 2 ? 1 : -1) * 6;
      pts.push(`L${r2(x1 + ux * d + nx * off)} ${r2(y1 + uy * d + ny * off)}`);
    }
    pts.push(`L${r2(x1 + ux * b)} ${r2(y1 + uy * b)}`, `L${r2(x2)} ${r2(y2)}`);
    line = pts.join("");
  } else line = `M${r2(x1)} ${r2(y1)}L${r2(x2)} ${r2(y2)}`;
  const heads: string[] = [];
  const bars: string[] = [];
  if (kind === "attacks") {
    bars.push(`M${r2(x2 + nx * 8)} ${r2(y2 + ny * 8)}L${r2(x2 - nx * 8)} ${r2(y2 - ny * 8)}`);
  } else if (kind === "conflicts") {
    heads.push(head(x2, y2, ux, uy), head(x1, y1, -ux, -uy));
  } else if (directed) heads.push(head(x2, y2, ux, uy));
  return { line, heads, bars };
}
