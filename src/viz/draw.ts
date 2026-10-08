// Draw items (research R1, R4): a flat, keyed, numeric description of one frame. Layout produces
// them; interpolation blends two lists by key; vnode.ts turns them into SVG.
import type { Relation } from "./schema";
import type { VizToken } from "./theme";

export type Paint = VizToken | "none";

export type RectItem = {
  kind: "rect";
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rx: number;
  fill: Paint;
  fillOpacity: number;
  stroke: Paint;
  strokeWidth: number;
  dash: string;
  opacity: number;
};

export type TextItem = {
  kind: "text";
  key: string;
  x: number;
  y: number;
  text: string;
  size: number;
  weight: number;
  anchor: "start" | "middle" | "end";
  fill: Paint;
  mono: boolean;
  italic: boolean;
  opacity: number;
};

export type LinkItem = {
  kind: "link";
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  relation: Relation;
  directed: boolean;
  stroke: Paint;
  strokeWidth: number;
  opacity: number;
};

export type DrawItem = RectItem | TextItem | LinkItem;

export function rect(key: string, x: number, y: number, w: number, h: number, o: Partial<RectItem> = {}): RectItem {
  return { kind: "rect", key, x, y, w, h, rx: 4, fill: "surface", fillOpacity: 1, stroke: "border", strokeWidth: 1.5, dash: "", opacity: 1, ...o };
}

export function text(key: string, x: number, y: number, value: string, o: Partial<TextItem> = {}): TextItem {
  return { kind: "text", key, x, y, text: value, size: 14, weight: 400, anchor: "start", fill: "text", mono: false, italic: false, opacity: 1, ...o };
}
