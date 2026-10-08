"use client";
// One frame as React SVG (FR-006), from the same virtual tree as the exported still (SC-006).
// Paints are CSS variables, so the drawing follows the app's light/dark theme without re-rendering.
// Elements of items that didn't change since the last frame are reused, so React skips them: during
// a transition only the moving items are reconciled (SC-002).
import { createElement, type ReactElement, useId } from "react";
import type { DrawItem } from "../draw";
import { sameItem } from "../interpolate";
import { captionAt } from "../state";
import { drawAt } from "../timeline";
import { sceneSize } from "../layout";
import type { Scene } from "../schema";
import { itemNode, svgTree, type VNode } from "../vnode";
import styles from "./viz.module.css";

function toReact(node: VNode, key?: string): ReactElement {
  const children = typeof node.children === "string" ? node.children : node.children?.map((c, i) => toReact(c, c.key ?? String(i)));
  return createElement(node.tag, { key, ...node.attrs, style: node.style }, children);
}

type Cached = { item: DrawItem; el: ReactElement | null };

// Elements depend only on their item (on-screen paints are CSS variables), so the cache is per scene.
const caches = new WeakMap<Scene, Map<string, Cached>>();

export function VizFrame({ scene, t, className }: { scene: Scene; t: number; className?: string }) {
  const id = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const { width, height } = sceneSize(scene);
  const origin = scene.origin === "ai-suggested" ? " (AI-suggested)" : "";
  const items = drawAt(scene, t);
  // The shell (title, desc, background) comes from svgTree with no items; items are added below.
  const tree = svgTree([], {
    width,
    height,
    title: `${scene.title}${origin}`,
    desc: `${scene.description} ${captionAt(scene, t)}.`,
    palette: null,
    idPrefix: `viz${id}`,
  });
  tree.attrs.className = [styles.svg, className].filter(Boolean).join(" ");

  const prevMap = caches.get(scene) ?? new Map<string, Cached>();
  const next = new Map<string, Cached>();
  const children: ReactElement[] = (tree.children as VNode[]).map((c) => toReact(c, c.key));
  for (const item of items) {
    const prev = prevMap.get(item.key);
    let el: ReactElement | null;
    if (prev && sameItem(prev.item, item)) el = prev.el;
    else {
      const node = itemNode(item, null);
      el = node ? toReact(node, item.key) : null;
    }
    next.set(item.key, { item, el });
    if (el) children.push(el);
  }
  caches.set(scene, next);
  return createElement("svg", { ...tree.attrs }, children);
}
