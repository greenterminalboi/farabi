// Draw items → virtual SVG nodes, shared by the string serializer (svg.ts) and the React frame
// (react/VizFrame.tsx), so the screen and the exported still are the same picture (SC-006).
// Attribute names are React's camelCase; svg.ts converts them to SVG's names.
import type { DrawItem, Paint } from "./draw";
import { FONT_MONO, FONT_SANS, linkPaths } from "./geometry";
import { type Palette, paint } from "./theme";

export type VNode = {
  tag: string;
  key?: string;
  attrs: Record<string, string>;
  style?: Record<string, string>;
  children?: VNode[] | string;
};

export const num = (n: number) => String(Math.round(n * 100) / 100);

function color(p: Paint, palette: Palette | null): string {
  return p === "none" ? "none" : paint(p, palette);
}

export function itemNode(item: DrawItem, palette: Palette | null): VNode | null {
  if (item.opacity <= 0.001) return null;
  const opacity = item.opacity >= 0.999 ? undefined : num(item.opacity);
  switch (item.kind) {
    case "rect": {
      const style: Record<string, string> = {
        fill: color(item.fill, palette),
        stroke: color(item.stroke, palette),
      };
      if (item.fill !== "none" && item.fillOpacity < 0.999) style.fillOpacity = num(item.fillOpacity);
      if (item.stroke !== "none") style.strokeWidth = num(item.strokeWidth);
      if (item.dash) style.strokeDasharray = item.dash;
      if (opacity) style.opacity = opacity;
      return {
        tag: "rect",
        key: item.key,
        attrs: { x: num(item.x), y: num(item.y), width: num(Math.max(0, item.w)), height: num(Math.max(0, item.h)), rx: num(item.rx) },
        style,
      };
    }
    case "text": {
      const style: Record<string, string> = {
        fill: color(item.fill, palette),
        fontSize: `${num(item.size)}px`,
        fontFamily: item.mono ? FONT_MONO : FONT_SANS,
      };
      if (item.weight !== 400) style.fontWeight = String(Math.round(item.weight / 100) * 100);
      if (item.italic) style.fontStyle = "italic";
      if (opacity) style.opacity = opacity;
      const attrs: Record<string, string> = { x: num(item.x), y: num(item.y) };
      if (item.anchor !== "start") attrs.textAnchor = item.anchor;
      if (item.mono) {
        // Keeps code indentation: xml:space for WebKit, white-space for the rest.
        attrs.xmlSpace = "preserve";
        style.whiteSpace = "pre";
      }
      return { tag: "text", key: item.key, attrs, style, children: item.text };
    }
    case "link": {
      const stroke = color(item.stroke, palette);
      const { line, heads, bars } = linkPaths(item.x1, item.y1, item.x2, item.y2, item.relation, item.directed);
      const lineStyle: Record<string, string> = { fill: "none", stroke, strokeWidth: num(item.strokeWidth), strokeLinejoin: "round" };
      if (item.relation === "attacks") lineStyle.strokeDasharray = "7 4";
      const children: VNode[] = [{ tag: "path", key: "l", attrs: { d: line }, style: lineStyle }];
      heads.forEach((d, i) => children.push({ tag: "path", key: `h${i}`, attrs: { d }, style: { fill: stroke, stroke: "none" } }));
      bars.forEach((d, i) =>
        children.push({ tag: "path", key: `b${i}`, attrs: { d }, style: { fill: "none", stroke, strokeWidth: num(item.strokeWidth + 1), strokeLinecap: "round" } }),
      );
      const g: VNode = { tag: "g", key: item.key, attrs: {}, children };
      if (opacity) g.style = { opacity };
      return g;
    }
  }
}

export type SvgOptions = {
  width: number;
  height: number;
  title: string;
  desc: string;
  /** Literal colours (stills) or null for CSS variables (on screen). */
  palette: Palette | null;
  /** Prefix for the title/desc ids, unique per page. */
  idPrefix: string;
};

/** The whole SVG document as one tree: accessible name and description, background, items. */
export function svgTree(items: DrawItem[], o: SvgOptions): VNode {
  const children: VNode[] = [
    { tag: "title", key: "title", attrs: { id: `${o.idPrefix}-title` }, children: o.title },
    { tag: "desc", key: "desc", attrs: { id: `${o.idPrefix}-desc` }, children: o.desc },
    {
      tag: "rect",
      key: "__bg",
      attrs: { x: "0", y: "0", width: num(o.width), height: num(o.height) },
      style: { fill: paint("bg", o.palette), stroke: "none" },
    },
  ];
  for (const item of items) {
    const node = itemNode(item, o.palette);
    if (node) children.push(node);
  }
  return {
    tag: "svg",
    attrs: {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: `0 0 ${num(o.width)} ${num(o.height)}`,
      width: num(o.width),
      height: num(o.height),
      role: "img",
      "aria-labelledby": `${o.idPrefix}-title ${o.idPrefix}-desc`,
    },
    children,
  };
}
