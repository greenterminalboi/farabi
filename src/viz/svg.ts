// SVG strings (FR-011, FR-012): stills on the server, in tests and in the browser's export, all from
// the same tree as the on-screen frame.
import type { Scene } from "./schema";
import { captionAt } from "./state";
import { type Palette, FALLBACK_PALETTES, type Scheme } from "./theme";
import { drawAt } from "./timeline";
import { layoutFrame, sceneSize } from "./layout";
import { svgTree, type VNode } from "./vnode";

const ATTR_NAMES: Record<string, string> = { xmlSpace: "xml:space", viewBox: "viewBox" };

const kebab = (name: string) => ATTR_NAMES[name] ?? name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function serialize(node: VNode): string {
  let out = `<${node.tag}`;
  for (const [k, v] of Object.entries(node.attrs)) out += ` ${kebab(k)}="${escapeXml(v)}"`;
  if (node.style) {
    const css = Object.entries(node.style)
      .map(([k, v]) => `${kebab(k)}:${v}`)
      .join(";");
    out += ` style="${escapeXml(css)}"`;
  }
  if (node.children === undefined || node.children.length === 0) return `${out}/>`;
  const inner = typeof node.children === "string" ? escapeXml(node.children) : node.children.map(serialize).join("");
  return `${out}>${inner}</${node.tag}>`;
}

export type RenderSvgOptions = {
  /** Literal colours; defaults to the fallback palette of `scheme`. */
  palette?: Palette;
  scheme?: Scheme;
  idPrefix?: string;
};

/** The still for position t (whole or in-between frame) as a self-contained SVG document. */
export function renderSvg(scene: Scene, t: number, options: RenderSvgOptions = {}): string {
  const palette = options.palette ?? FALLBACK_PALETTES[options.scheme ?? "light"];
  const { width, height } = sceneSize(scene);
  const origin = scene.origin === "ai-suggested" ? " (AI-suggested)" : "";
  const tree = svgTree(drawAt(scene, t), {
    width,
    height,
    title: `${scene.title}${origin}`,
    desc: `${scene.description} ${captionAt(scene, t)}.`,
    palette,
    idPrefix: options.idPrefix ?? "viz",
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialize(tree)}`;
}

export { layoutFrame };
