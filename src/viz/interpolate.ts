// In-between frames (research R4): two draw lists blended by key. Numbers interpolate, strings and
// paints switch half way, items present on one side only fade in or out.
import type { DrawItem } from "./draw";

export const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

export function sameItem(a: DrawItem, b: DrawItem): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  const ra = a as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(b)) if (ra[k] !== v) return false;
  return true;
}

function blendItem(a: DrawItem, b: DrawItem, p: number): DrawItem {
  // Unchanged items keep their identity, so the React frame can skip them (SC-002).
  if (sameItem(a, b)) return b;
  if (a.kind !== b.kind) return p < 0.5 ? a : b;
  const out: Record<string, unknown> = {};
  const ra = a as unknown as Record<string, unknown>;
  for (const [k, vb] of Object.entries(b)) {
    const va = ra[k];
    out[k] = typeof vb === "number" && typeof va === "number" ? lerp(va, vb, p) : p < 0.5 ? (va ?? vb) : vb;
  }
  return out as DrawItem;
}

/** Blends frame `a` into frame `b` at progress p ∈ [0, 1] (already eased). */
export function blend(a: DrawItem[], b: DrawItem[], p: number): DrawItem[] {
  if (p <= 0) return a;
  if (p >= 1) return b;
  const before = new Map(a.map((item) => [item.key, item]));
  const out: DrawItem[] = [];
  const used = new Set<string>();
  for (const item of b) {
    const prev = before.get(item.key);
    if (prev) {
      used.add(item.key);
      out.push(blendItem(prev, item, p));
    } else out.push({ ...item, opacity: item.opacity * p });
  }
  for (const item of a) if (!used.has(item.key)) out.push({ ...item, opacity: item.opacity * (1 - p) });
  return out;
}
