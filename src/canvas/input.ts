// Pointer, wheel and keyboard on the canvas (contracts/canvas-ui.md "Pointer, wheel and keyboard";
// research R11).
// - A press on text starts a native selection, never a drag.
// - A press on a frame (its padding, header or footer, or the drawn frame) moves the element after
//   4 px, Alt moves its tree, and the origin edge always moves its tree. Less than 4 px is a click,
//   which focuses the element without moving the camera.
// - A press on the background pans; a plain wheel pans; Ctrl/Cmd + wheel or a pinch zooms. Every
//   manual move frees the camera.
import type { Camera } from "./camera";
import type { CanvasRenderer } from "./renderer/CanvasRenderer";

export const DRAG_THRESHOLD = 4;

export type Walk = "parent" | "child" | "prev" | "next";

export type InputHandlers = {
  focus: (id: string) => void;
  /** A drag of one element (or its whole tree), in world units since the press. */
  drag: (id: string, phase: "start" | "move" | "end" | "cancel", delta: { x: number; y: number }, tree: boolean) => void;
  /** Origin edges always move their tree. */
  isOrigin: (id: string) => boolean;
  walk: (dir: Walk) => void;
  escape: () => void;
  slash: () => void;
  backgroundClick: () => void;
};

const INTERACTIVE = "button, input, textarea, select, a, [data-action], [data-overlay]";

export function installInput(opts: {
  host: HTMLElement;
  layerRoot: HTMLElement;
  renderer: CanvasRenderer;
  camera: Camera;
  handlers: InputHandlers;
}): () => void {
  const { host, layerRoot, renderer, camera, handlers } = opts;
  const canvas = renderer.canvas!;
  const disposers: Array<() => void> = [];
  const on = <K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Window,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ) => {
    target.addEventListener(type, fn as EventListener, options);
    disposers.push(() => target.removeEventListener(type, fn as EventListener, options));
  };

  // Wheel events over text belong to the canvas: forward them so panning and zooming work anywhere.
  on(
    layerRoot,
    "wheel",
    (e) => {
      if ((e.target as Element).closest("[data-overlay]")) return;
      e.preventDefault();
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaMode: e.deltaMode,
          clientX: e.clientX,
          clientY: e.clientY,
          ctrlKey: e.ctrlKey || e.metaKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { passive: false },
  );

  // Manual camera moves free the camera; programmatic glides report other types.
  const viewport = renderer.viewport!;
  const manual = (e: { type?: string }) => {
    if (e?.type && ["drag", "wheel", "wheel-scroll", "pinch"].includes(e.type)) camera.onManual();
  };
  viewport.on("moved", manual);
  viewport.on("zoomed", manual);
  disposers.push(() => {
    viewport.off("moved", manual);
    viewport.off("zoomed", manual);
  });

  // Presses. Capture on the host runs before PixiJS sees the event, so a frame press can turn off
  // background panning first.
  let press: { id: string; tree: boolean; x: number; y: number; world: { x: number; y: number }; dragging: boolean } | null = null;
  let backgroundDown: { x: number; y: number } | null = null;

  const framePress = (id: string, e: PointerEvent) => {
    const rect = host.getBoundingClientRect();
    const local = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    press = {
      id,
      tree: e.altKey || handlers.isOrigin(id),
      x: e.clientX,
      y: e.clientY,
      world: renderer.screenToWorld(local),
      dragging: false,
    };
    renderer.setPanEnabled(false);
    // No text selection starts from a frame.
    e.preventDefault();
  };

  on(
    host,
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest(INTERACTIVE)) return;
      const item = target.closest<HTMLElement>(".element-text");
      if (item) {
        // Text is for selecting; the item's own padding and its header and footer are the frame.
        if (target.closest(".element-body") && target !== item) return;
        framePress(item.dataset.nodeId!, e);
        return;
      }
      if (target === canvas) {
        const rect = host.getBoundingClientRect();
        const world = renderer.screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        const hit = renderer.elementAt(world);
        if (hit) framePress(hit.id, e);
        else backgroundDown = { x: e.clientX, y: e.clientY };
      }
    },
    { capture: true },
  );

  on(window, "pointermove", (e) => {
    if (!press) return;
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    if (!press.dragging && moved < DRAG_THRESHOLD) return;
    const rect = host.getBoundingClientRect();
    const world = renderer.screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    const delta = { x: world.x - press.world.x, y: world.y - press.world.y };
    if (!press.dragging) {
      press.dragging = true;
      handlers.drag(press.id, "start", { x: 0, y: 0 }, press.tree);
    }
    handlers.drag(press.id, "move", delta, press.tree);
  });

  const release = (e: PointerEvent, cancelled: boolean) => {
    if (backgroundDown) {
      const moved = Math.hypot(e.clientX - backgroundDown.x, e.clientY - backgroundDown.y);
      if (!cancelled && moved < DRAG_THRESHOLD) handlers.backgroundClick();
      backgroundDown = null;
    }
    if (!press) return;
    const p = press;
    press = null;
    renderer.setPanEnabled(true);
    if (!p.dragging) {
      // A click focuses; a drag past the threshold never does (FR-037).
      if (!cancelled) handlers.focus(p.id);
      return;
    }
    const rect = host.getBoundingClientRect();
    const world = renderer.screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    handlers.drag(p.id, cancelled ? "cancel" : "end", { x: world.x - p.world.x, y: world.y - p.world.y }, p.tree);
  };
  on(window, "pointerup", (e) => release(e, false));
  on(window, "pointercancel", (e) => release(e, true));

  on(window, "keydown", (e) => {
    const t = e.target as HTMLElement | null;
    const typing = t?.closest("input, textarea, select, [contenteditable='true']");
    if (e.key === "Escape") {
      handlers.escape();
      return;
    }
    if (typing) return;
    if (e.key === "/" && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      handlers.slash();
      return;
    }
    if (!e.altKey) return;
    const dir: Walk | null =
      e.key === "ArrowUp" ? "parent" : e.key === "ArrowDown" ? "child" : e.key === "ArrowLeft" ? "prev" : e.key === "ArrowRight" ? "next" : null;
    if (!dir) return;
    e.preventDefault();
    handlers.walk(dir);
  });

  return () => {
    for (const d of disposers) d();
  };
}
