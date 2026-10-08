"use client";
// One frame as React SVG (FR-006), from the same virtual tree as the exported still (SC-006).
// Paints are CSS variables, so the drawing follows the app's light/dark theme without re-rendering.
import { createElement, type ReactElement, useId } from "react";
import { captionAt } from "../state";
import { drawAt } from "../timeline";
import { sceneSize } from "../layout";
import type { Scene } from "../schema";
import { svgTree, type VNode } from "../vnode";
import styles from "./viz.module.css";

function toReact(node: VNode, key?: string): ReactElement {
  const children = typeof node.children === "string" ? node.children : node.children?.map((c, i) => toReact(c, c.key ?? String(i)));
  return createElement(node.tag, { key, ...node.attrs, style: node.style }, children);
}

export function VizFrame({ scene, t, className }: { scene: Scene; t: number; className?: string }) {
  const id = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const { width, height } = sceneSize(scene);
  const origin = scene.origin === "ai-suggested" ? " (AI-suggested)" : "";
  const tree = svgTree(drawAt(scene, t), {
    width,
    height,
    title: `${scene.title}${origin}`,
    desc: `${scene.description} ${captionAt(scene, t)}.`,
    palette: null,
    idPrefix: `viz${id}`,
  });
  tree.attrs.className = [styles.svg, className].filter(Boolean).join(" ");
  return toReact(tree);
}
