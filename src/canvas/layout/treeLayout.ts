// A first-child-aligned tidy tree with variable box sizes (research R10). A run of question, answer,
// question, answer reads as a column; every later child (a branch, a re-ask, another attempt, a
// function edge) fans out to the right, and subtree contours are kept apart, so nothing overlaps
// and adding a branch never moves the column it leaves (FR-036).

/** Vertical gap from a question bubble down to its answer. */
export const GAP_TO_ANSWER = 24;
/** Vertical gap from an answer (or output) down to the next bubble. */
export const GAP_TO_QUESTION = 40;
/** Horizontal gap between neighbouring subtrees. */
export const SIBLING_GAP = 48;
/** Vertical gap from a function connector down to its output. */
export const GAP_TO_OUTPUT = 16;

export type LayoutNode = {
  id: string;
  width: number;
  height: number;
  /** "edge" boxes are bubbles or connectors; "node" boxes are answers and outputs. */
  shape: "node" | "edge";
  /** Function connectors sit beside their input, not below it. */
  beside?: boolean;
  /** An anchored branch: where its span sits in the parent's text, 0..1 of the parent's height. */
  anchorAt?: number | null;
  /** The child that continues the column, if any; listed first in `children`. */
  first: LayoutNode | null;
  /** The other children, in creation order. */
  others: LayoutNode[];
};

/** Piecewise-constant profile over y: for each [y0, y1) the extreme x of the subtree there. */
type Seg = { y0: number; y1: number; v: number };
type Profile = Seg[];

/** A laid-out subtree: its contours and extents, relative to its root's top-left. */
type Laid = {
  left: Profile;
  right: Profile;
  minX: number;
  maxX: number;
  maxY: number;
};

const shift = (p: Profile, dx: number, dy: number): Profile => p.map((s) => ({ y0: s.y0 + dy, y1: s.y1 + dy, v: s.v + dx }));

/** The sorted, distinct segment boundaries of two profiles, merged in one pass. */
function boundaries(a: Profile, b: Profile): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  const na = a.length * 2;
  const nb = b.length * 2;
  const ya = (k: number) => (k % 2 === 0 ? a[k >> 1].y0 : a[k >> 1].y1);
  const yb = (k: number) => (k % 2 === 0 ? b[k >> 1].y0 : b[k >> 1].y1);
  while (i < na || j < nb) {
    const y = j >= nb || (i < na && ya(i) <= yb(j)) ? ya(i++) : yb(j++);
    if (out.length === 0 || out[out.length - 1] !== y) out.push(y);
  }
  return out;
}

/**
 * Pointwise max (or min) of two profiles over the union of their y ranges, in one sweep. Profiles
 * are sorted and non-overlapping, so every interval between boundaries lies inside one segment (or
 * gap) of each.
 */
function merge(a: Profile, b: Profile, pick: (x: number, y: number) => number): Profile {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const cuts = boundaries(a, b);
  const out: Profile = [];
  let ia = 0;
  let ib = 0;
  for (let k = 0; k < cuts.length - 1; k++) {
    const y0 = cuts[k];
    const y1 = cuts[k + 1];
    while (ia < a.length && a[ia].y1 <= y0) ia++;
    while (ib < b.length && b[ib].y1 <= y0) ib++;
    const va = ia < a.length && a[ia].y0 <= y0 ? a[ia].v : undefined;
    const vb = ib < b.length && b[ib].y0 <= y0 ? b[ib].v : undefined;
    if (va === undefined && vb === undefined) continue;
    const v = va === undefined ? vb! : vb === undefined ? va : pick(va, vb);
    const last = out[out.length - 1];
    if (last && last.y1 === y0 && last.v === v) last.y1 = y1;
    else out.push({ y0, y1, v });
  }
  return out;
}

/** The smallest dx so that `left` shifted by dx clears `right` by `gap` wherever they overlap in y. */
function clearance(right: Profile, left: Profile, gap: number): number {
  let need = -Infinity;
  let i = 0;
  let j = 0;
  while (i < right.length && j < left.length) {
    const r = right[i];
    const l = left[j];
    if (r.y0 < l.y1 + gap / 2 && l.y0 < r.y1 + gap / 2) need = Math.max(need, r.v - l.v + gap);
    if (r.y1 < l.y1) i++;
    else j++;
  }
  return need;
}

function box(x0: number, x1: number, y0: number, y1: number): { left: Profile; right: Profile } {
  // A zero-height box (a connector) still occupies a sliver, so neighbours never overlap it.
  const y1b = Math.max(y1, y0 + 1);
  return { left: [{ y0, y1: y1b, v: x0 }], right: [{ y0, y1: y1b, v: x1 }] };
}

function gapBelow(parent: LayoutNode): number {
  if (parent.beside) return GAP_TO_OUTPUT;
  return parent.shape === "edge" ? GAP_TO_ANSWER : GAP_TO_QUESTION;
}

/**
 * Lays out every subtree bottom-up, without recursion (a 5,000-element column is 5,000 levels deep):
 * each node records its offset from its parent, and positions are summed top-down at the end.
 */
function layoutAll(root: LayoutNode): { offsets: Map<string, { dx: number; dy: number }>; laid: Laid } {
  const offsets = new Map<string, { dx: number; dy: number }>([[root.id, { dx: 0, dy: 0 }]]);
  const laid = new Map<string, Laid>();
  // Post-order: a node is laid out once all its children are.
  const order: LayoutNode[] = [];
  const stack = [root];
  while (stack.length) {
    const n = stack.pop()!;
    order.push(n);
    if (n.first) stack.push(n.first);
    for (const c of n.others) stack.push(c);
  }
  for (let k = order.length - 1; k >= 0; k--) {
    const n = order[k];
    const own = box(0, n.width, 0, n.height);
    let left = own.left;
    let right = own.right;
    let minX = 0;
    let maxX = n.width;
    let maxY = n.height;
    const place = (child: LayoutNode, dx: number, dy: number) => {
      const sub = laid.get(child.id)!;
      laid.delete(child.id);
      offsets.set(child.id, { dx, dy });
      left = merge(left, shift(sub.left, dx, dy), Math.min);
      right = merge(right, shift(sub.right, dx, dy), Math.max);
      minX = Math.min(minX, sub.minX + dx);
      maxX = Math.max(maxX, sub.maxX + dx);
      maxY = Math.max(maxY, sub.maxY + dy);
    };

    // The column: the first child centred directly below.
    if (n.first) place(n.first, (n.width - n.first.width) / 2, n.height + gapBelow(n));

    // Everything else to the right, clear of all that is already placed.
    for (const child of n.others) {
      const sub = laid.get(child.id)!;
      let dy: number;
      if (child.beside) dy = 0;
      else if (child.anchorAt != null) dy = Math.round(Math.min(1, Math.max(0, child.anchorAt)) * n.height);
      else dy = n.height + gapBelow(n);
      const dx = Math.max(clearance(right, shift(sub.left, 0, dy), SIBLING_GAP), n.width + SIBLING_GAP - sub.minX);
      place(child, dx, dy);
    }
    laid.set(n.id, { left, right, minX, maxX, maxY });
  }
  return { offsets, laid: laid.get(root.id)! };
}

export type TreeLayout = {
  /** Top-left of every box, relative to the origin edge's top-left (the tree origin). */
  positions: Map<string, { x: number; y: number }>;
  box: { minX: number; minY: number; maxX: number; maxY: number };
};

/** Lays out one tree from its origin edge. Hand placement is applied by the caller (FR-037). */
export function layoutTree(root: LayoutNode): TreeLayout {
  const { offsets, laid } = layoutAll(root);
  const positions = new Map<string, { x: number; y: number }>();
  const stack: Array<[LayoutNode, number, number]> = [[root, 0, 0]];
  while (stack.length) {
    const [n, px, py] = stack.pop()!;
    const o = offsets.get(n.id)!;
    const x = px + o.dx;
    const y = py + o.dy;
    positions.set(n.id, { x, y });
    if (n.first) stack.push([n.first, x, y]);
    for (const c of n.others) stack.push([c, x, y]);
  }
  return { positions, box: { minX: laid.minX, minY: 0, maxX: laid.maxX, maxY: laid.maxY } };
}
