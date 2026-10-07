"use client";

// What the canvas host shares with its overlays: the two layers, the camera and a few verbs. The
// overlays are React (screen space); everything here is imperative.
import { createContext, useContext, useEffect, useState } from "react";
import type { Element } from "@/shared/schemas";
import type { Camera } from "./camera";
import type { CanvasRenderer } from "./renderer/CanvasRenderer";
import type { TextLayer } from "./text/TextLayer";

export type CanvasEngine = {
  renderer: CanvasRenderer;
  layer: TextLayer;
  camera: Camera;
  /** Focus an element and glide to it: a walk or a send (FR-025). */
  walkTo: (id: string) => void;
  /** Merge rows an action returned, then lay out and draw. */
  merge: (elements: Element[]) => void;
  /** Subscribe to camera and layout changes, for screen-space overlays. */
  onFrame: (cb: () => void) => () => void;
  /** The element's frame on screen, relative to the canvas root. */
  screenRect: (id: string) => { x: number; y: number; w: number; h: number } | null;
  /** The canvas root's size. */
  size: () => { width: number; height: number };
  /** Ask the composer to take the keyboard ("/"). */
  focusComposer: () => void;
};

export const EngineContext = createContext<CanvasEngine | null>(null);

export function useEngine(): CanvasEngine | null {
  return useContext(EngineContext);
}

/** Re-renders on every camera or layout frame (for overlays that follow an element). */
export function useFrame(engine: CanvasEngine | null): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!engine) return;
    let raf = 0;
    return engine.onFrame(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setTick((t) => t + 1);
      });
    });
  }, [engine]);
  return tick;
}
