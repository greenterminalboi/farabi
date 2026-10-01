"use client";

import { useEffect, useRef } from "react";
import type { TextItem } from "@/canvas/text/TextLayer";

type Props = { n: number; willChange: boolean; total?: number; floor?: number };

declare global {
  interface Window {
    __farabiFrameStats?: (ms: number) => Promise<{ p50: number; p95: number; max: number; frames: number }>;
    __farabiTextStats?: () => import("@/canvas/text/TextLayer").TextStats;
    __farabiSpike?: {
      ready: number | null;
      /** When the text layer was given its items (synthetic data generation excluded). */
      layerStart: number;
      setCamera: (scale: number, centerX: number, centerY: number) => void;
      bounds: { minX: number; minY: number; maxX: number; maxY: number };
      /** Page coordinates of the first characters of a mounted item, for selecting them. */
      textPoint: (id: string) => { x: number; y: number; width: number; height: number } | null;
      ids: string[];
    };
  }
}

const WIDTH = 480;
const COL_GAP = 80;
const ROW_GAP = 40;

// Deterministic text shaped like real answers: mean about 1,700 characters, longest about 8,000,
// paragraphs with some bold and lists (research R17, owner's data on 2026-10-01).
const WORDS = (
  "pods containers scheduling nodes cluster network service volume replica controller state " +
  "the a of to and in is that for it as with be on not this by are or from at which an have " +
  "learning memory attention gradient model layer weights training data loss function value"
).split(" ");

function makeRandom(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

function makeText(rand: () => number): string {
  // Skewed length: most around 1,000–2,500, a few up to 8,000.
  const target = Math.min(8000, Math.round(300 + -Math.log(1 - rand() * 0.999) * 1400));
  const parts: string[] = [];
  let len = 0;
  while (len < target) {
    let para: string;
    if (rand() < 0.2) {
      para = Array.from({ length: 2 + Math.floor(rand() * 4) }, () => `- ${sentence(rand, 6 + Math.floor(rand() * 10))}`).join("\n");
    } else {
      para = Array.from({ length: 2 + Math.floor(rand() * 4) }, () => sentence(rand, 8 + Math.floor(rand() * 14))).join(" ");
    }
    parts.push(para);
    len += para.length + 2;
  }
  return parts.join("\n\n");
}

function sentence(rand: () => number, words: number): string {
  const ws = Array.from({ length: words }, () => WORDS[Math.floor(rand() * WORDS.length)]);
  if (rand() < 0.3) {
    const i = Math.floor(rand() * (ws.length - 1));
    ws[i] = `**${ws[i]}**`;
  }
  const s = ws.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

/** Rough height for the spike; the real estimator is T027. */
function heightFor(text: string): number {
  const blocks = text.split("\n\n").length;
  return Math.ceil(text.length / 56) * 24 + blocks * 12 + 32;
}

export function CanvasSpike({ n, willChange, total, floor }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let destroyed = false;
    let cleanup = () => {};

    void (async () => {
      const [{ Application, Graphics }, { Viewport }, { TextLayer }] = await Promise.all([
        import("pixi.js"),
        import("pixi-viewport"),
        import("@/canvas/text/TextLayer"),
      ]);
      await document.fonts.load("15px OpenDyslexic").catch(() => []);
      if (destroyed) return;

      // Columns of elements, like conversations laid out as columns.
      const rand = makeRandom(7);
      const perColumn = Math.max(1, Math.round(Math.sqrt(n / 2)));
      const items: TextItem[] = [];
      const colY = new Map<number, number>();
      for (let i = 0; i < n; i++) {
        const col = Math.floor(i / perColumn);
        const text = makeText(rand);
        const height = heightFor(text);
        const y = colY.get(col) ?? 0;
        colY.set(col, y + height + ROW_GAP);
        items.push({
          id: `e${i}`,
          x: col * (WIDTH + COL_GAP),
          y,
          width: WIDTH,
          height,
          className: "answer",
          source: text,
          markdown: true,
          version: 0,
        });
      }
      const bounds = {
        minX: 0,
        minY: 0,
        maxX: Math.max(...items.map((i) => i.x + i.width)),
        maxY: Math.max(...items.map((i) => i.y + i.height)),
      };

      const app = new Application();
      await app.init({
        resizeTo: host,
        background: 0xf7f7f5,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      });
      if (destroyed) {
        app.destroy(true);
        return;
      }
      host.appendChild(app.canvas);
      const viewport = new Viewport({
        screenWidth: host.clientWidth,
        screenHeight: host.clientHeight,
        events: app.renderer.events,
        passiveWheel: false,
      });
      // A plain wheel pans; Ctrl/Cmd + wheel (and a trackpad pinch) zooms (research R11).
      viewport
        .drag({ wheel: true })
        .wheel({ wheelZoom: false, trackpadPinch: true })
        .pinch()
        .clampZoom({ minScale: 0.02, maxScale: 4 });
      app.stage.addChild(viewport);
      app.renderer.on("resize", (w: number, h: number) => viewport.resize(w, h));

      // The drawn layer: frames only, no text (FR-031).
      const frames = new Graphics();
      for (const item of items) {
        frames.roundRect(item.x, item.y, item.width, item.height, 10).fill(0xffffff).stroke({ width: 1, color: 0xd8d8d2 });
      }
      viewport.addChild(frames);

      const layerStart = performance.now();
      const layer = new TextLayer(host, { willChange, total, floor });
      layer.setItems(items);

      // Wheel events over text are the canvas's: forward them so panning and zooming work anywhere.
      layer.root.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          app.canvas.dispatchEvent(
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

      // One camera for both layers, written in the frame the canvas renders (FR-029).
      let dirty = true;
      viewport.on("moved", () => (dirty = true));
      viewport.on("zoomed", () => (dirty = true));
      const sync = () => {
        if (!dirty) return;
        dirty = false;
        layer.setCamera({
          scale: viewport.scale.x,
          x: viewport.x,
          y: viewport.y,
          screenWidth: viewport.screenWidth,
          screenHeight: viewport.screenHeight,
        });
      };
      app.ticker.add(sync);

      const setCamera = (scale: number, cx: number, cy: number) => {
        viewport.setZoom(scale, true);
        viewport.moveCenter(cx, cy);
        dirty = true;
      };
      // Start fully zoomed out: the hardest case, every element in view.
      const fit = Math.max(0.02, Math.min(host.clientWidth / (bounds.maxX + 200), host.clientHeight / (bounds.maxY + 200)));
      setCamera(fit, bounds.maxX / 2, bounds.maxY / 2);

      const hooks: NonNullable<Window["__farabiSpike"]> = {
        ready: null,
        layerStart,
        setCamera,
        bounds,
        ids: items.map((i) => i.id),
        textPoint: (id) => {
          const span = layer.element(id)?.querySelector("span[data-start]");
          if (!span) return null;
          const r = span.getBoundingClientRect();
          return { x: r.left, y: r.top, width: r.width, height: r.height };
        },
      };
      window.__farabiSpike = hooks;
      window.__farabiTextStats = () => layer.stats();
      window.__farabiFrameStats = (ms) =>
        new Promise((resolve) => {
          const deltas: number[] = [];
          let last = performance.now();
          const end = last + ms;
          const tick = (now: number) => {
            deltas.push(now - last);
            last = now;
            if (now < end) requestAnimationFrame(tick);
            else {
              const sorted = [...deltas].sort((a, b) => a - b);
              const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
              resolve({ p50: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? 0, frames: deltas.length });
            }
          };
          requestAnimationFrame(tick);
        });
      const offIdle = layer.onIdle(() => {
        if (hooks.ready === null) hooks.ready = performance.now();
      });

      cleanup = () => {
        offIdle();
        layer.destroy();
        app.destroy(true, { children: true });
        delete window.__farabiSpike;
        delete window.__farabiTextStats;
        delete window.__farabiFrameStats;
      };
    })();

    return () => {
      destroyed = true;
      cleanup();
    };
  }, [n, willChange, total, floor]);

  return <div ref={hostRef} className="canvas-host" data-testid="canvas" />;
}
