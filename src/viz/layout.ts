// Frame state → draw items (feature 014, research R1). Deterministic: the same scene and frame give
// the same list everywhere. Keys are stable across frames (array cells by identity, pointers by name,
// the current code line by element), so interpolation animates movement rather than replacement.
import { type DrawItem, type LinkItem, rect, type RectItem, text } from "./draw";
import { center, clipToRect, ellipsize, type Rect, textWidth, wrap } from "./geometry";
import { DEFAULT_HEIGHT, DEFAULT_WIDTH, type Element, type GraphElement, type Relation, type Scene, type Tone } from "./schema";
import { edgeId, type ElementState, type FrameState } from "./state";
import { toneToken, type VizToken } from "./theme";

type Def<T extends Element["type"]> = Extract<Element, { type: T }>;
type St<T extends ElementState["type"]> = Extract<ElementState, { type: T }>;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Fill and outline for a tone: tinted fill, coloured outline, thicker when highlighted (FR-005). */
function toned(tone: Tone | null | undefined, highlighted: boolean, base: Partial<RectItem> = {}): Partial<RectItem> {
  const token = toneToken(tone);
  if (!token) return base;
  // Muted means "out of play": a faint fill and a thin outline, never louder than normal.
  if (token === "muted") return { ...base, fill: "muted", fillOpacity: 0.1, stroke: "border", strokeWidth: 1, dash: "3 3" };
  return { ...base, fill: token, fillOpacity: 0.14, stroke: token, strokeWidth: highlighted ? 3 : 2 };
}

const effectiveTone = (st: { tone: Tone | null }, def: { tone?: Tone }) => st.tone ?? def.tone ?? null;

// ---------------------------------------------------------------- sizes (shared with connectors)

const BOX_FONT = 14;
const ROLE_LABEL: Record<NonNullable<Def<"box">["role"]>, string> = {
  claim: "CLAIM",
  premise: "PREMISE",
  evidence: "EVIDENCE",
  conclusion: "CONCLUSION",
  note: "NOTE",
};

function boxGeometry(def: Def<"box">, label: string) {
  const w = def.w ?? clamp(textWidth(label, BOX_FONT) + 28, 80, 260);
  const lines = wrap(label, w - 24, BOX_FONT, 6);
  const roleH = def.role ? 16 : 0;
  const h = def.h ?? Math.max(40, lines.length * 18 + 22 + roleH);
  return { w, h, lines, roleH };
}

const TEXT_SIZES = { sm: 12, md: 15, lg: 20 } as const;

function textGeometry(def: Def<"text">, value: string) {
  const size = TEXT_SIZES[def.size ?? "md"];
  const lines = def.w ? wrap(value, def.w, size, 8) : value.split("\n");
  const w = def.w ?? Math.max(...lines.map((l) => textWidth(l, size)));
  return { size, lines, w, h: lines.length * size * 1.3 };
}

const CODE_FONT = 13;
const CODE_LINE = 20;

function codeGeometry(def: Def<"code">) {
  const gutter = String(def.lines.length).length * CODE_FONT * 0.6 + 26;
  const longest = Math.max(...def.lines.map((l) => textWidth(l.replace(/\t/g, "  "), CODE_FONT, true)));
  const w = def.w ?? clamp(longest + gutter + 20, 200, 720);
  const titleH = def.title || def.language ? 24 : 0;
  return { w, h: titleH + def.lines.length * CODE_LINE + 16, gutter, titleH };
}

function arrayGeometry(def: Def<"array">, st: St<"array">) {
  const longest = Math.max(0, ...st.cells.map((c) => textWidth(String(c.value), 15, true)));
  const cw = def.cellWidth ?? clamp(longest + 18, 44, 120);
  const labelH = def.label ? 20 : 0;
  const n = Math.max(1, st.cells.length);
  const pointerRows = Math.max(0, ...countPointerRows(st));
  return { cw, ch: 40, labelH, w: n * cw, h: labelH + 40 + (def.showIndices === false ? 0 : 16) + pointerRows * 30 };
}

function countPointerRows(st: St<"array">): number[] {
  const perIndex = new Map<number, number>();
  for (const p of st.pointers) if (p.index !== null) perIndex.set(p.index, (perIndex.get(p.index) ?? 0) + 1);
  return [...perIndex.values()];
}

function panelGeometry(def: Def<"panel">, st: St<"panel">) {
  const rows = st.rows.filter((r) => r.visible);
  const widest = Math.max(0, ...rows.map((r) => textWidth(r.key, 13) + textWidth(String(r.value), 13, true) + 40));
  const w = def.w ?? clamp(Math.max(widest, textWidth(def.label ?? "", 12) + 24), 150, 360);
  return { w, h: 28 + Math.max(1, rows.length) * 24 + 6, rows };
}

function stackGeometry(def: Def<"stack">, st: St<"stack">) {
  const widest = Math.max(0, ...st.frames.map((f) => textWidth(f.label, 13, true) + 24));
  const w = def.w ?? clamp(widest, 160, 320);
  return { w, h: 28 + Math.max(1, st.frames.length) * 32 + 4 };
}

// ---------------------------------------------------------------- graph layouts

type NodeBox = Rect & { id: string };

function graphNodeSize(label: string) {
  return { w: clamp(textWidth(label, 13) + 22, 36, 150), h: 32 };
}

function graphPositions(def: GraphElement, labels: Record<string, string>): Map<string, NodeBox> {
  const W = def.w ?? 420;
  const H = def.h ?? 260;
  const nodes = def.nodes;
  const ids = nodes.map((n) => n.id);
  const children = new Map<string, string[]>(ids.map((id) => [id, []]));
  const incoming = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const e of def.edges) {
    children.get(e.from)?.push(e.to);
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  }
  const centers = new Map<string, { x: number; y: number }>();
  const layout = def.layout ?? "layered";

  if (layout === "tree") {
    // Tidy tree: leaves take successive slots, parents sit over the middle of their children.
    const roots = [def.root ?? ids.find((id) => !incoming.get(id)) ?? ids[0]];
    const depth = new Map<string, number>();
    const slot = new Map<string, number>();
    let next = 0;
    const visit = (id: string, d: number) => {
      depth.set(id, d);
      const kids = (children.get(id) ?? []).filter((k) => !depth.has(k));
      kids.forEach((k) => depth.set(k, d + 1));
      if (!kids.length) slot.set(id, next++);
      else {
        kids.forEach((k) => visit(k, d + 1));
        slot.set(id, (slot.get(kids[0])! + slot.get(kids[kids.length - 1])!) / 2);
      }
    };
    for (let i = 0; i < roots.length; i++) {
      visit(roots[i], 0);
      const left = ids.find((id) => !depth.has(id));
      if (left) roots.push(left);
    }
    const maxDepth = Math.max(1, ...depth.values());
    const cols = Math.max(1, next);
    for (const id of ids) {
      centers.set(id, { x: ((slot.get(id)! + 0.5) / cols) * W, y: 22 + (depth.get(id)! / maxDepth) * (H - 44) });
    }
  } else if (layout === "layered") {
    // Longest path from the sources; back edges (cycles) are ignored.
    const layer = new Map<string, number>();
    const visiting = new Set<string>();
    const depthOf = (id: string): number => {
      if (layer.has(id)) return layer.get(id)!;
      visiting.add(id);
      let d = 0;
      for (const e of def.edges) {
        if (e.to !== id || visiting.has(e.from)) continue;
        d = Math.max(d, depthOf(e.from) + 1);
      }
      visiting.delete(id);
      layer.set(id, d);
      return d;
    };
    ids.forEach(depthOf);
    const layers = Math.max(...layer.values()) + 1;
    const byLayer = new Map<number, string[]>();
    for (const id of ids) byLayer.set(layer.get(id)!, [...(byLayer.get(layer.get(id)!) ?? []), id]);
    for (const [l, members] of byLayer) {
      members.forEach((id, k) => {
        centers.set(id, {
          x: ((k + 0.5) / members.length) * W,
          y: layers === 1 ? H / 2 : 22 + (l / (layers - 1)) * (H - 44),
        });
      });
    }
  } else if (layout === "circle") {
    const n = ids.length;
    ids.forEach((id, k) => {
      const a = -Math.PI / 2 + (2 * Math.PI * k) / n;
      centers.set(id, { x: W / 2 + Math.cos(a) * (W / 2 - 60), y: H / 2 + Math.sin(a) * (H / 2 - 24) });
    });
  } else {
    nodes.forEach((n, k) => {
      const auto = { x: ((k + 0.5) / nodes.length) * W, y: H / 2 };
      centers.set(n.id, layout === "manual" ? { x: n.x ?? auto.x, y: n.y ?? auto.y } : auto);
    });
  }

  const out = new Map<string, NodeBox>();
  for (const id of ids) {
    const c = centers.get(id)!;
    const { w, h } = graphNodeSize(labels[id]);
    out.set(id, { id, x: def.x + c.x - w / 2, y: def.y + c.y - h / 2, w, h, round: true });
  }
  return out;
}

// ---------------------------------------------------------------- links

const RELATION_TOKEN: Record<Relation, VizToken> = { plain: "connector", supports: "good", attacks: "bad", conflicts: "bad" };

function linkItems(
  key: string,
  from: Rect,
  to: Rect,
  relation: Relation,
  directed: boolean | undefined,
  label: string | undefined,
  tone: Tone | null,
  highlighted: boolean,
): DrawItem[] {
  const a = clipToRect(from, center(to).x, center(to).y);
  const b = clipToRect(to, center(from).x, center(from).y, 4);
  const token = toneToken(tone) ?? RELATION_TOKEN[relation];
  const link: LinkItem = {
    kind: "link",
    key,
    x1: a.x,
    y1: a.y,
    x2: b.x,
    y2: b.y,
    relation,
    directed: directed ?? relation !== "conflicts",
    stroke: token,
    strokeWidth: highlighted ? 3 : relation === "plain" ? 1.5 : 2,
    opacity: 1,
  };
  const items: DrawItem[] = [link];
  const shown = label ?? (relation === "conflicts" ? "conflicts" : undefined);
  if (shown) {
    const mx = (a.x + b.x) / 2;
    // A conflict's label sits above its zigzag, so the zigzag stays visible.
    const my = (a.y + b.y) / 2 - (relation === "conflicts" ? 20 : 0);
    const w = textWidth(shown, 11) + 12;
    items.push(rect(`${key}:lb`, mx - w / 2, my - 9, w, 18, { rx: 9, fill: "surface", stroke: token, strokeWidth: 1 }));
    items.push(text(`${key}:lt`, mx, my + 4, shown, { size: 11, anchor: "middle", fill: token, weight: 600 }));
  }
  return items;
}

// ---------------------------------------------------------------- per element

function layoutBox(def: Def<"box">, st: St<"box">): { items: DrawItem[]; bounds: Rect } {
  const g = boxGeometry(def, st.label);
  const tone = effectiveTone(st, def);
  const shape = def.shape ?? "round";
  const rx = shape === "rect" ? 3 : shape === "round" ? 10 : Math.min(g.w, g.h) / 2;
  const items: DrawItem[] = [
    rect(`${def.id}`, st.x, st.y, g.w, g.h, {
      rx,
      ...toned(tone, st.tone !== null, def.role === "conclusion" ? { strokeWidth: 2.5, stroke: "text" } : {}),
    }),
  ];
  const cx = st.x + g.w / 2;
  const textTop = st.y + (g.h - (g.lines.length * 18 + g.roleH)) / 2;
  if (def.role) {
    items.push(text(`${def.id}:role`, cx, textTop + 11, ROLE_LABEL[def.role], { size: 10, weight: 700, anchor: "middle", fill: "muted" }));
  }
  g.lines.forEach((line, i) => {
    items.push(
      text(`${def.id}:t${i}`, cx, textTop + g.roleH + 13 + i * 18, line, {
        size: BOX_FONT,
        anchor: "middle",
        weight: def.role === "conclusion" ? 600 : 400,
      }),
    );
  });
  return { items, bounds: { x: st.x, y: st.y, w: g.w, h: g.h, round: shape === "ellipse" } };
}

function layoutText(def: Def<"text">, st: St<"text">): { items: DrawItem[]; bounds: Rect } {
  const g = textGeometry(def, st.text);
  const align = def.align ?? "start";
  const ax = def.w ? (align === "middle" ? st.x + def.w / 2 : align === "end" ? st.x + def.w : st.x) : st.x;
  const token = toneToken(effectiveTone(st, def));
  const items = g.lines.map((line, i) =>
    text(`${def.id}:t${i}`, ax, st.y + g.size + i * g.size * 1.3, line, {
      size: g.size,
      anchor: align,
      weight: def.size === "lg" ? 600 : 400,
      fill: token ?? "text",
    }),
  );
  const left = def.w ? st.x : align === "middle" ? st.x - g.w / 2 : align === "end" ? st.x - g.w : st.x;
  return { items, bounds: { x: left, y: st.y, w: g.w, h: g.h } };
}

function layoutCode(def: Def<"code">, st: St<"code">): { items: DrawItem[]; bounds: Rect } {
  const g = codeGeometry(def);
  const { x, y } = st;
  const tone = effectiveTone(st, def);
  const items: DrawItem[] = [rect(def.id, x, y, g.w, g.h, { rx: 6, ...toned(tone, st.tone !== null) })];
  if (g.titleH) {
    items.push(text(`${def.id}:title`, x + 12, y + 17, def.title ?? def.language ?? "", { size: 12, weight: 600, fill: "muted" }));
    items.push(rect(`${def.id}:rule`, x, y + g.titleH, g.w, 1, { rx: 0, fill: "border", stroke: "none", strokeWidth: 0 }));
  }
  const top = y + g.titleH + 8;
  const textX = x + g.gutter;
  const charW = CODE_FONT * 0.6;
  for (const [lineStr, tone] of Object.entries(st.lineTones)) {
    const ln = Number(lineStr);
    const token = toneToken(tone) ?? "accent";
    items.push(rect(`${def.id}:lt${ln}`, x + 4, top + (ln - 1) * CODE_LINE, g.w - 8, CODE_LINE, { rx: 3, fill: token, fillOpacity: 0.16, stroke: "none", strokeWidth: 0 }));
  }
  if (st.line !== null) {
    const ly = top + (st.line - 1) * CODE_LINE;
    items.push(rect(`${def.id}:cur`, x + 4, ly, g.w - 8, CODE_LINE, { rx: 3, fill: "accent", fillOpacity: 0.18, stroke: "accent", strokeWidth: 1.5 }));
    items.push(text(`${def.id}:arrow`, x + 6, ly + 14.5, "▶", { size: 10, fill: "accent" }));
    st.tokens.forEach((t, k) => {
      items.push(
        rect(`${def.id}:tok${k}`, textX + t.start * charW - 1, ly + 2, (t.end - t.start) * charW + 2, CODE_LINE - 4, {
          rx: 2,
          fill: "partial",
          fillOpacity: 0.22,
          stroke: "partial",
          strokeWidth: 1.5,
        }),
      );
    });
  }
  const maxW = g.w - g.gutter - 10;
  def.lines.forEach((line, i) => {
    const ly = top + i * CODE_LINE + 14.5;
    items.push(text(`${def.id}:n${i}`, textX - 10, ly, String(i + 1), { size: 11, mono: true, fill: "muted", anchor: "end" }));
    const shown = ellipsize(line.replace(/\t/g, "  ").replace(/\s+$/, ""), maxW, CODE_FONT, true);
    if (shown) items.push(text(`${def.id}:l${i}`, textX, ly, shown, { size: CODE_FONT, mono: true, weight: st.line === i + 1 ? 600 : 400 }));
  });
  return { items, bounds: { x, y, w: g.w, h: g.h } };
}

const MARK_STYLE = {
  compare: { stroke: "partial", strokeWidth: 3, dash: "5 3" },
  swap: { stroke: "accent", strokeWidth: 3, dash: "" },
  changed: { stroke: "good", strokeWidth: 3, dash: "" },
} as const;

function layoutArray(def: Def<"array">, st: St<"array">): { items: DrawItem[]; bounds: Rect } {
  const g = arrayGeometry(def, st);
  const { x, y } = st;
  const items: DrawItem[] = [];
  const tone = effectiveTone(st, def);
  if (def.label) items.push(text(`${def.id}:label`, x, y + 13, def.label, { size: 12, weight: 600, fill: toneToken(tone) ?? "muted" }));
  const top = y + g.labelH;
  if (!st.cells.length) items.push(rect(`${def.id}:empty`, x, top, g.cw, g.ch, { dash: "4 3", fill: "none" }));
  st.cells.forEach((cell, i) => {
    const cx = x + i * g.cw;
    const cellTone = cell.tone ?? (tone && tone !== "default" ? tone : null);
    const style: Partial<RectItem> = { rx: 3, ...toned(cellTone, cell.tone !== null) };
    if (cell.mark) Object.assign(style, MARK_STYLE[cell.mark]);
    items.push(rect(`${def.id}:${cell.key}`, cx + 2, top, g.cw - 4, g.ch, style));
    const shown = ellipsize(String(cell.value), g.cw - 10, 15, true);
    items.push(
      text(`${def.id}:${cell.key}:v`, cx + g.cw / 2, top + 25, shown, {
        size: 15,
        mono: true,
        anchor: "middle",
        weight: cell.mark ? 700 : 500,
        fill: cellTone === "muted" && !cell.mark ? "muted" : "text",
      }),
    );
  });
  let below = top + g.ch;
  if (def.showIndices !== false) {
    st.cells.forEach((_, i) => {
      items.push(text(`${def.id}:i${i}`, x + i * g.cw + g.cw / 2, below + 13, String(i), { size: 11, mono: true, anchor: "middle", fill: "muted" }));
    });
    below += 16;
  }
  const seen = new Map<number, number>();
  for (const p of st.pointers) {
    if (p.index === null) continue;
    const row = seen.get(p.index) ?? 0;
    seen.set(p.index, row + 1);
    const px = x + p.index * g.cw + g.cw / 2;
    const py = below + row * 30;
    items.push(text(`${def.id}:p:${p.name}:a`, px, py + 12, "▲", { size: 12, anchor: "middle", fill: "accent" }));
    items.push(text(`${def.id}:p:${p.name}`, px, py + 26, p.name, { size: 12, mono: true, weight: 700, anchor: "middle", fill: "accent" }));
  }
  return { items, bounds: { x, y, w: g.w, h: g.h } };
}

function layoutPanel(def: Def<"panel">, st: St<"panel">): { items: DrawItem[]; bounds: Rect } {
  const g = panelGeometry(def, st);
  const { x, y } = st;
  const tone = effectiveTone(st, def);
  const items: DrawItem[] = [rect(def.id, x, y, g.w, g.h, { rx: 6, ...toned(tone, st.tone !== null) })];
  items.push(text(`${def.id}:label`, x + 10, y + 18, def.label ?? "Variables", { size: 12, weight: 600, fill: "muted" }));
  if (!g.rows.length) items.push(text(`${def.id}:empty`, x + 10, y + 44, "(empty)", { size: 12, italic: true, fill: "muted" }));
  g.rows.forEach((row, i) => {
    const ry = y + 28 + i * 24;
    const key = `${def.id}:row:${row.key}`;
    const rowTone = row.tone ?? (row.changed ? "good" : null);
    if (rowTone) {
      items.push(rect(`${key}:bg`, x + 4, ry, g.w - 8, 22, { rx: 3, ...toned(rowTone, row.tone !== null), strokeWidth: row.changed && !row.tone ? 1.5 : 2.5 }));
    }
    const keyText = ellipsize(row.key, g.w / 2 - 14, 13);
    items.push(text(`${key}:k`, x + 10, ry + 15.5, keyText, { size: 13 }));
    items.push(
      text(`${key}:v`, x + g.w - 10, ry + 15.5, ellipsize(String(row.value), g.w - textWidth(keyText, 13) - 34, 13, true), {
        size: 13,
        mono: true,
        anchor: "end",
        weight: row.changed ? 700 : 400,
      }),
    );
  });
  return { items, bounds: { x, y, w: g.w, h: g.h } };
}

function layoutStack(def: Def<"stack">, st: St<"stack">): { items: DrawItem[]; bounds: Rect } {
  const g = stackGeometry(def, st);
  const { x, y } = st;
  const tone = effectiveTone(st, def);
  const items: DrawItem[] = [rect(def.id, x, y, g.w, g.h, { rx: 6, fill: "none", ...toned(tone, st.tone !== null) })];
  items.push(text(`${def.id}:label`, x + 10, y + 18, def.label ?? "Call stack", { size: 12, weight: 600, fill: "muted" }));
  if (!st.frames.length) items.push(text(`${def.id}:empty`, x + 10, y + 46, "(empty)", { size: 12, italic: true, fill: "muted" }));
  const n = st.frames.length;
  st.frames.forEach((f, i) => {
    const row = n - 1 - i; // top of the stack first
    const fy = y + 28 + row * 32;
    const top = i === n - 1;
    const style: Partial<RectItem> = { rx: 4, ...(top ? { stroke: "accent", strokeWidth: 2 } : {}), ...toned(f.tone, f.tone !== null) };
    if (f.changed && !f.tone) Object.assign(style, { stroke: "good", strokeWidth: 2.5 });
    items.push(rect(`${def.id}:${f.key}`, x + 6, fy, g.w - 12, 28, style));
    items.push(text(`${def.id}:${f.key}:t`, x + 16, fy + 18.5, ellipsize(f.label, g.w - 60, 13, true), { size: 13, mono: true, weight: top ? 600 : 400 }));
    if (top) items.push(text(`${def.id}:top`, x + g.w - 14, fy + 18, "top", { size: 10, anchor: "end", fill: "accent", weight: 600 }));
  });
  return { items, bounds: { x, y, w: g.w, h: g.h } };
}

function layoutGraph(def: Def<"graph">, st: St<"graph">): { items: DrawItem[]; bounds: Rect } {
  const labels = Object.fromEntries(def.nodes.map((n) => [n.id, st.nodes[n.id].label]));
  const shifted = { ...def, x: st.x, y: st.y };
  const boxes = graphPositions(shifted, labels);
  const items: DrawItem[] = [];
  for (const e of def.edges) {
    const id = edgeId(e);
    const es = st.edges[id];
    if (!es.visible || !st.nodes[e.from].visible || !st.nodes[e.to].visible) continue;
    items.push(...linkItems(`${def.id}:e:${id}`, boxes.get(e.from)!, boxes.get(e.to)!, e.relation ?? "plain", e.directed, e.label, es.tone, es.tone !== null));
  }
  const graphTone = st.tone ?? def.tone ?? null;
  for (const n of def.nodes) {
    const ns = st.nodes[n.id];
    if (!ns.visible) continue;
    const b = boxes.get(n.id)!;
    const tone = ns.tone ?? n.tone ?? graphTone;
    items.push(rect(`${def.id}:n:${n.id}`, b.x, b.y, b.w, b.h, { rx: b.h / 2, ...toned(tone, ns.tone !== null) }));
    items.push(text(`${def.id}:n:${n.id}:t`, b.x + b.w / 2, b.y + 20.5, ellipsize(ns.label, b.w - 14, 13), { size: 13, anchor: "middle", weight: ns.tone ? 600 : 400 }));
  }
  return { items, bounds: { x: st.x, y: st.y, w: def.w ?? 420, h: def.h ?? 260 } };
}

/** Every visible element's draw items for one frame, connectors underneath. */
export function layoutFrame(scene: Scene, state: FrameState): DrawItem[] {
  const bounds = new Map<string, Rect>();
  const bodies: DrawItem[] = [];
  for (const def of scene.elements) {
    const st = state.elements[def.id];
    if (def.type === "connector") continue;
    let out: { items: DrawItem[]; bounds: Rect };
    switch (def.type) {
      case "box":
        out = layoutBox(def, st as St<"box">);
        break;
      case "text":
        out = layoutText(def, st as St<"text">);
        break;
      case "code":
        out = layoutCode(def, st as St<"code">);
        break;
      case "array":
        out = layoutArray(def, st as St<"array">);
        break;
      case "panel":
        out = layoutPanel(def, st as St<"panel">);
        break;
      case "stack":
        out = layoutStack(def, st as St<"stack">);
        break;
      case "graph":
        out = layoutGraph(def, st as St<"graph">);
        break;
    }
    bounds.set(def.id, out.bounds);
    if (st.visible) bodies.push(...out.items);
  }
  const links: DrawItem[] = [];
  for (const def of scene.elements) {
    if (def.type !== "connector") continue;
    const st = state.elements[def.id];
    if (!st.visible || !state.elements[def.from].visible || !state.elements[def.to].visible) continue;
    const tone = effectiveTone(st, def);
    links.push(...linkItems(def.id, bounds.get(def.from)!, bounds.get(def.to)!, def.relation ?? "plain", def.directed, def.label, tone, st.tone !== null));
  }
  const items = [...links, ...bodies];
  if (scene.origin === "ai-suggested") {
    const w = scene.width ?? DEFAULT_WIDTH;
    const label = "AI-suggested";
    const bw = textWidth(label, 11) + 16;
    items.push(rect("__badge", w - bw - 8, 8, bw, 20, { rx: 10, fill: "surface", stroke: "ai", strokeWidth: 1.5, dash: "4 2" }));
    items.push(text("__badge:t", w - bw / 2 - 8, 22, label, { size: 11, weight: 600, anchor: "middle", fill: "ai" }));
  }
  return items;
}

export const sceneSize = (scene: Scene) => ({ width: scene.width ?? DEFAULT_WIDTH, height: scene.height ?? DEFAULT_HEIGHT });
