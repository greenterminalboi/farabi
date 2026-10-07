// How many characters of text each mounted element gets (research R8). The total stays roughly
// constant whatever the zoom: at the furthest zoom thousands of elements share it, zoomed in a few
// elements get their full text.

export type BudgetItem = {
  id: string;
  /** On-screen area of the element's box, in CSS pixels. */
  screenArea: number;
  /** Length of the element's full text. */
  fullChars: number;
  /** Holds a selection, a composer with text, or a streaming reply: always gets its full text. */
  pinned: boolean;
};

// Measured in M0 (research R17): paint cost follows mounted characters. 30k keeps panning and
// zooming at 60 fps with 5,000 elements in view, and still gives a zoomed-in screen full text.
export const TOTAL_CHARS = 30_000;
export const FLOOR_CHARS = 6;

/**
 * Shares `total` characters among visible items in proportion to their on-screen area. Every item
 * gets at least `min(floor, fullChars)`, never more than `fullChars`; pinned items get their full
 * text on top of the total. Area an item can't use (it is already whole) goes to the others.
 */
export function allocate(items: BudgetItem[], total = TOTAL_CHARS, floor = FLOOR_CHARS): Map<string, number> {
  const out = new Map<string, number>();
  let remaining = total;
  let open: BudgetItem[] = [];
  for (const item of items) {
    if (item.pinned) {
      out.set(item.id, item.fullChars);
      continue;
    }
    const base = Math.min(floor, item.fullChars);
    out.set(item.id, base);
    remaining -= base;
    if (item.fullChars > base) open.push(item);
  }
  if (remaining <= 0 || open.length === 0) return out;

  // Water-filling in one sorted pass: items that would fill up first (least room per unit of area)
  // take their room; the rest share what's left by area.
  const areaOf = (item: BudgetItem) => Math.max(item.screenArea, 1);
  const roomOf = (item: BudgetItem) => item.fullChars - out.get(item.id)!;
  open = open.sort((a, b) => roomOf(a) / areaOf(a) - roomOf(b) / areaOf(b));
  let areaLeft = open.reduce((sum, item) => sum + areaOf(item), 0);
  for (const item of open) {
    const area = areaOf(item);
    const room = roomOf(item);
    const granted = Math.min(room, Math.floor((remaining * area) / areaLeft));
    out.set(item.id, out.get(item.id)! + granted);
    remaining -= granted;
    areaLeft -= area;
  }
  return out;
}
