// The drawn layer of the canvas (research R7; contracts/canvas-ui.md): PixiJS with pixi-viewport.
// It draws element frames, connectors, tree regions, the path emphasis and the focus ring, and no
// text at all (FR-031): every word, including frame labels, is in the DOM text layer above it.
// Imperative: React mounts it once and drives it through methods.
import { Application, Container, Graphics, Rectangle } from "pixi.js";
import { Viewport } from "pixi-viewport";
import type { Display } from "@/shared/kinds";
import type { Review } from "@/shared/schemas";
import type { CameraView } from "../camera";
import type { Box } from "../geometry";

type Palette = {
  bg: number;
  surface: number;
  border: number;
  bubble: number;
  bubbleBorder: number;
  ai: number;
  aiFill: number;
  connector: number;
  focus: number;
  danger: number;
  region: number;
};

const LIGHT: Palette = {
  bg: 0xf7f7f5,
  surface: 0xffffff,
  border: 0xd8d8d2,
  bubble: 0xe7ecff,
  bubbleBorder: 0xc5cff5,
  ai: 0x7048e8,
  aiFill: 0xf4f0fe,
  connector: 0x9a9aa0,
  focus: 0xfab005,
  danger: 0xc92a2a,
  region: 0xefefeb,
};

const DARK: Palette = {
  bg: 0x161618,
  surface: 0x1f1f22,
  border: 0x38383e,
  bubble: 0x252b45,
  bubbleBorder: 0x39426a,
  ai: 0x9775fa,
  aiFill: 0x2a2340,
  connector: 0x707078,
  focus: 0xfab005,
  danger: 0xe03131,
  region: 0x1c1c1f,
};

/** Everything the renderer needs about one element. */
export type DrawElement = {
  id: string;
  treeId: string;
  parentId: string | null;
  display: Display;
  box: Box;
  /** Continues its parent's column (drawn as a straight connector from the parent's bottom). */
  column: boolean;
  /** Where an anchored branch leaves its parent's text, 0..1 of the parent's height. */
  anchorAt: number | null;
  origin: boolean;
  unsent: boolean;
  status: "pending" | "complete" | "incomplete" | "stopped" | "failed" | null;
  review: Review | null;
};

export type Scene = {
  elements: DrawElement[];
  trees: Map<string, { minX: number; minY: number; maxX: number; maxY: number }>;
  focusId: string | null;
  /** The focused element and its ancestors (FR-026). */
  path: Set<string>;
};

export type FrameDragPhase = "start" | "move" | "end" | "cancel";
type Point = { x: number; y: number };

const DIM = 0.45;
const RADIUS = { answer: 10, output: 10, question: 18, function_connector: 0 } as const;
const REGION_PAD = 40;

declare global {
  interface Window {
    __farabiCanvasDebug?: () => {
      elements: Array<{ id: string; kind: Display; shape: "node" | "edge"; x: number; y: number; w: number; h: number; treeId: string; focused: boolean; onPath: boolean }>;
      trees: Record<string, { minX: number; minY: number; maxX: number; maxY: number }>;
    };
    __farabiScreenPoint?: (id: string, part?: "frame" | "text") => Point | null;
  }
}

function bezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

export class CanvasRenderer {
  private app: Application | null = null;
  viewport: Viewport | null = null;
  private palette: Palette = LIGHT;
  private regionLayer = new Graphics();
  private treeLayer = new Container();
  private focusLayer = new Graphics();
  private trees = new Map<string, { dim: Graphics; full: Graphics }>();
  private scene: Scene = { elements: [], trees: new Map(), focusId: null, path: new Set() };
  private byId = new Map<string, DrawElement>();
  private cameraListeners = new Set<() => void>();
  private cameraDirty = true;
  private minScale = 0.02;
  private resizeObserver: ResizeObserver | null = null;

  async mount(host: HTMLElement): Promise<void> {
    this.palette = window.matchMedia("(prefers-color-scheme: dark)").matches ? DARK : LIGHT;
    const app = new Application();
    await app.init({
      resizeTo: host,
      background: this.palette.bg,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    app.canvas.dataset.testid = "canvas-drawn";
    host.prepend(app.canvas);
    const viewport = new Viewport({
      screenWidth: host.clientWidth,
      screenHeight: host.clientHeight,
      events: app.renderer.events,
      // The app's own ticker: the viewport moves, then the text layer follows, then the frame draws.
      ticker: app.ticker,
      passiveWheel: false,
      // A fixed, very large hit area: the default one lags a tick behind programmatic moves.
      forceHitArea: new Rectangle(-1e7, -1e7, 2e7, 2e7),
    });
    // A plain wheel pans; Ctrl/Cmd + wheel and a trackpad pinch zoom (research R11).
    viewport
      .drag({ wheel: true })
      .wheel({ wheelZoom: false, trackpadPinch: true })
      .pinch()
      .clampZoom({ minScale: this.minScale, maxScale: 4 });
    viewport.addChild(this.regionLayer, this.treeLayer, this.focusLayer);
    app.stage.addChild(viewport);
    // The host changes size with the side panel too, not only with the window.
    this.resizeObserver = new ResizeObserver(() => app.resize());
    this.resizeObserver.observe(host);
    app.renderer.on("resize", (w: number, h: number) => {
      viewport.resize(w, h);
      this.cameraDirty = true;
    });
    viewport.on("moved", () => (this.cameraDirty = true));
    viewport.on("zoomed", () => (this.cameraDirty = true));
    // The text layer's transform is written in the frame the canvas renders (FR-029). The actual
    // transform is compared each tick: a glide's last step can land without a "moved" event.
    let last = "";
    app.ticker.add(() => {
      const now = `${viewport.x},${viewport.y},${viewport.scale.x},${viewport.screenWidth},${viewport.screenHeight}`;
      if (!this.cameraDirty && now === last) return;
      this.cameraDirty = false;
      last = now;
      for (const cb of this.cameraListeners) cb();
    });
    this.app = app;
    this.viewport = viewport;
    this.redrawAll();
  }

  get canvas(): HTMLCanvasElement | null {
    return this.app?.canvas ?? null;
  }

  /** Called in the same frame as each render in which the camera changed. */
  onCameraChange(cb: () => void): () => void {
    this.cameraListeners.add(cb);
    return () => this.cameraListeners.delete(cb);
  }

  camera(): { scale: number; x: number; y: number; screenWidth: number; screenHeight: number } {
    const v = this.viewport;
    if (!v) return { scale: 1, x: 0, y: 0, screenWidth: 0, screenHeight: 0 };
    return { scale: v.scale.x, x: v.x, y: v.y, screenWidth: v.screenWidth, screenHeight: v.screenHeight };
  }

  /** The camera's view of this renderer (camera.ts). */
  cameraView(): CameraView {
    return {
      scale: () => this.viewport?.scale.x ?? 1,
      center: () => {
        const c = this.viewport?.center;
        return { x: c?.x ?? 0, y: c?.y ?? 0 };
      },
      screen: () => ({ width: this.viewport?.screenWidth ?? 0, height: this.viewport?.screenHeight ?? 0 }),
      moveTo: (to, ms) => {
        const v = this.viewport;
        if (!v) return;
        v.plugins.remove("animate");
        if (ms <= 0) {
          v.setZoom(to.scale, true);
          v.moveCenter(to.x, to.y);
          this.cameraDirty = true;
          return;
        }
        v.animate({ position: { x: to.x, y: to.y }, scale: to.scale, time: ms, ease: "easeInOutSine", removeOnInterrupt: true });
      },
      setMinScale: (min) => {
        this.minScale = min;
        this.viewport?.clampZoom({ minScale: min, maxScale: 4 });
      },
    };
  }

  /** Replaces the scene. Only trees in `changed` (or all, when omitted) are redrawn. */
  setScene(scene: Scene, changed?: Set<string>): void {
    const pathChanged = scene.focusId !== this.scene.focusId || !sameSet(scene.path, this.scene.path);
    const touched = new Set<string>(changed ?? scene.trees.keys());
    if (pathChanged) {
      // Path emphasis spans the old and the new focused tree.
      for (const id of [this.scene.focusId, scene.focusId]) {
        const el = id ? (this.byId.get(id) ?? scene.elements.find((e) => e.id === id)) : undefined;
        if (el) touched.add(el.treeId);
      }
      if ((this.scene.focusId === null) !== (scene.focusId === null)) for (const t of scene.trees.keys()) touched.add(t);
    }
    this.scene = scene;
    this.byId = new Map(scene.elements.map((e) => [e.id, e]));
    if (!this.app) return;
    for (const [id, t] of this.trees) {
      if (!scene.trees.has(id)) {
        t.dim.destroy();
        t.full.destroy();
        this.trees.delete(id);
      }
    }
    const byTree = groupByTree(scene.elements);
    for (const treeId of touched) this.drawTree(treeId, byTree.get(treeId) ?? []);
    this.drawRegions();
    this.drawFocus();
  }

  private redrawAll(): void {
    const byTree = groupByTree(this.scene.elements);
    for (const treeId of this.scene.trees.keys()) this.drawTree(treeId, byTree.get(treeId) ?? []);
    this.drawRegions();
    this.drawFocus();
  }

  private treeGraphics(treeId: string): { dim: Graphics; full: Graphics } {
    let t = this.trees.get(treeId);
    if (!t) {
      t = { dim: new Graphics(), full: new Graphics() };
      t.dim.alpha = DIM;
      this.treeLayer.addChild(t.dim, t.full);
      this.trees.set(treeId, t);
    }
    return t;
  }

  private drawTree(treeId: string, elements: DrawElement[]): void {
    const t = this.treeGraphics(treeId);
    t.dim.clear();
    t.full.clear();
    const emphasis = this.scene.focusId !== null;
    // Full contrast on the focused path, reduced everywhere else (FR-026).
    const layer = (onPath: boolean) => (!emphasis || onPath ? t.full : t.dim);
    // Connectors first, under the frames.
    for (const el of elements) this.drawConnectors(el, layer);
    for (const el of elements) this.drawFrame(el, layer(this.scene.path.has(el.id)));
  }

  private drawConnectors(el: DrawElement, layer: (onPath: boolean) => Graphics): void {
    if (!el.parentId || el.display === "function_connector") return; // function edges: drawn from their outputs
    const parent = this.byId.get(el.parentId);
    if (!parent) return;
    const p = this.palette;
    const g = layer(this.scene.path.has(el.id) && this.scene.path.has(parent.id));
    // An output's connector starts at the function's input and carries the edge's review (FR-049).
    if (parent.display === "function_connector") {
      const input = parent.parentId ? this.byId.get(parent.parentId) : undefined;
      if (!input) return;
      const from = { x: input.box.x + input.box.w, y: input.box.y + 22 };
      const to = { x: el.box.x, y: el.box.y + 22 };
      const dx = Math.max(30, (to.x - from.x) / 2);
      const curve: [Point, Point, Point, Point] = [from, { x: from.x + dx, y: from.y }, { x: to.x - dx, y: to.y }, to];
      const confirmed = parent.review === "confirmed";
      this.strokeCurve(g, curve, p.ai, confirmed ? null : 6);
      // Arrowhead into the output.
      g.moveTo(to.x - 8, to.y - 5).lineTo(to.x, to.y).lineTo(to.x - 8, to.y + 5).stroke({ width: 1.5, color: p.ai });
      return;
    }
    const top = { x: el.box.x + el.box.w / 2, y: el.box.y };
    let from: Point;
    if (el.column) from = { x: parent.box.x + parent.box.w / 2, y: parent.box.y + parent.box.h };
    else if (el.anchorAt !== null) from = { x: parent.box.x + parent.box.w, y: parent.box.y + el.anchorAt * parent.box.h };
    else from = { x: parent.box.x + parent.box.w, y: parent.box.y + parent.box.h - 16 };
    if (el.column) {
      g.moveTo(from.x, from.y).lineTo(top.x, top.y).stroke({ width: 1.5, color: p.connector });
      return;
    }
    const midY = from.y + Math.max(12, (top.y - from.y) / 2);
    const curve: [Point, Point, Point, Point] = [from, { x: top.x, y: from.y }, { x: top.x, y: midY }, top];
    this.strokeCurve(g, curve, p.connector, el.unsent ? 5 : null);
    if (el.anchorAt !== null) g.circle(from.x, from.y, 3).fill(p.focus);
  }

  private strokeCurve(g: Graphics, curve: [Point, Point, Point, Point], color: number, dash: number | null): void {
    const samples = 28;
    const pts = Array.from({ length: samples + 1 }, (_, i) => bezier(...curve, i / samples));
    if (dash === null) {
      g.moveTo(pts[0].x, pts[0].y);
      for (const q of pts.slice(1)) g.lineTo(q.x, q.y);
      g.stroke({ width: 1.5, color });
      return;
    }
    // Dashes along the sampled curve.
    let on = true;
    let left = dash;
    for (let i = 0; i < pts.length - 1; i++) {
      let a = pts[i];
      const b = pts[i + 1];
      let seg = Math.hypot(b.x - a.x, b.y - a.y);
      while (seg > 0) {
        const step = Math.min(left, seg);
        const t = step / seg;
        const c = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        if (on) g.moveTo(a.x, a.y).lineTo(c.x, c.y);
        a = c;
        seg -= step;
        left -= step;
        if (left <= 0) {
          on = !on;
          left = dash;
        }
      }
    }
    g.stroke({ width: 1.5, color });
  }

  private drawFrame(el: DrawElement, g: Graphics): void {
    const p = this.palette;
    const { x, y, w, h } = el.box;
    switch (el.display) {
      case "function_connector":
        return;
      case "question": {
        const r = RADIUS.question;
        if (el.unsent) {
          g.roundRect(x, y, w, h, r).fill({ color: p.surface, alpha: 0.6 });
          this.dashedRect(g, x, y, w, h, p.bubbleBorder);
        } else g.roundRect(x, y, w, h, r).fill(p.bubble).stroke({ width: 1, color: p.bubbleBorder });
        // The origin edge carries a small handle for moving its tree (FR-037).
        if (el.origin) {
          for (const dy of [-6, 0, 6]) g.circle(x - 10, y + h / 2 + dy, 2).fill(p.connector);
        }
        return;
      }
      case "answer": {
        const failed = el.status === "failed";
        g.roundRect(x, y, w, h, RADIUS.answer)
          .fill(p.surface)
          .stroke({ width: 1, color: failed ? p.danger : p.border });
        // The header strip; its AI tag and state are text, in the text layer.
        g.moveTo(x + 1, y + 30).lineTo(x + w - 1, y + 30).stroke({ width: 1, color: p.border, alpha: 0.6 });
        return;
      }
      case "output": {
        const rejected = el.review === "rejected";
        g.roundRect(x, y, w, h, RADIUS.output).fill({ color: p.aiFill, alpha: rejected ? 0.5 : 1 });
        if (el.review === "confirmed") g.roundRect(x, y, w, h, RADIUS.output).stroke({ width: 1.5, color: p.ai });
        else this.dashedRect(g, x, y, w, h, p.ai);
        return;
      }
    }
  }

  private dashedRect(g: Graphics, x: number, y: number, w: number, h: number, color: number): void {
    const dash = 6;
    const line = (x0: number, y0: number, x1: number, y1: number) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      for (let d = 0; d < len; d += dash * 2) {
        const a = d / len;
        const b = Math.min(1, (d + dash) / len);
        g.moveTo(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a).lineTo(x0 + (x1 - x0) * b, y0 + (y1 - y0) * b);
      }
    };
    line(x, y, x + w, y);
    line(x + w, y, x + w, y + h);
    line(x + w, y + h, x, y + h);
    line(x, y + h, x, y);
    g.stroke({ width: 1, color });
  }

  /** A faint region around each tree, so trees read as separate (FR-005). */
  private drawRegions(): void {
    const g = this.regionLayer;
    g.clear();
    for (const b of this.scene.trees.values()) {
      g.roundRect(b.minX - REGION_PAD, b.minY - REGION_PAD, b.maxX - b.minX + REGION_PAD * 2, b.maxY - b.minY + REGION_PAD * 2, 28).fill(
        this.palette.region,
      );
    }
  }

  private drawFocus(): void {
    const g = this.focusLayer;
    g.clear();
    const el = this.scene.focusId ? this.byId.get(this.scene.focusId) : undefined;
    if (!el || el.display === "function_connector") return;
    const { x, y, w, h } = el.box;
    const r = el.display === "question" ? RADIUS.question : RADIUS.answer;
    g.roundRect(x - 4, y - 4, w + 8, h + 8, r + 4).stroke({ width: 2.5, color: this.palette.focus });
  }

  /** The element whose frame is under a world point, topmost first. */
  elementAt(world: Point): DrawElement | null {
    for (let i = this.scene.elements.length - 1; i >= 0; i--) {
      const el = this.scene.elements[i];
      if (el.display === "function_connector") continue;
      const b = el.box;
      if (world.x >= b.x && world.x <= b.x + b.w && world.y >= b.y && world.y <= b.y + b.h) return el;
    }
    return null;
  }

  element(id: string): DrawElement | undefined {
    return this.byId.get(id);
  }

  worldToScreen(p: Point): Point {
    const v = this.viewport;
    if (!v) return p;
    return { x: p.x * v.scale.x + v.x, y: p.y * v.scale.y + v.y };
  }

  screenToWorld(p: Point): Point {
    const v = this.viewport;
    if (!v) return p;
    return { x: (p.x - v.x) / v.scale.x, y: (p.y - v.y) / v.scale.y };
  }

  /** An element's frame on screen, relative to the canvas host. */
  elementScreenRect(id: string): { x: number; y: number; w: number; h: number } | null {
    const el = this.byId.get(id);
    if (!el) return null;
    const a = this.worldToScreen({ x: el.box.x, y: el.box.y });
    const s = this.viewport?.scale.x ?? 1;
    return { x: a.x, y: a.y, w: el.box.w * s, h: Math.max(el.box.h * s, 1) };
  }

  /** Lets a frame press stop the background drag from panning (input.ts). */
  setPanEnabled(enabled: boolean): void {
    const v = this.viewport;
    if (!v) return;
    if (enabled) v.plugins.resume("drag");
    else v.plugins.pause("drag");
  }

  private hooks: { debug?: Window["__farabiCanvasDebug"]; point?: Window["__farabiScreenPoint"] } = {};

  /** Test hooks; installed by the host once this renderer is the live one. */
  installHooks(): void {
    if (process.env.NEXT_PUBLIC_FARABI_TEST_HOOKS !== "1") return;
    window.__farabiCanvasDebug = this.hooks.debug = () => ({
      elements: this.scene.elements.map((e) => ({
        id: e.id,
        kind: e.display,
        shape: e.display === "question" || e.display === "function_connector" ? "edge" : "node",
        x: e.box.x,
        y: e.box.y,
        w: e.box.w,
        h: e.box.h,
        treeId: e.treeId,
        focused: e.id === this.scene.focusId,
        onPath: this.scene.path.has(e.id),
      })),
      trees: Object.fromEntries(this.scene.trees),
    });
    window.__farabiScreenPoint = this.hooks.point = (id, part = "frame") => {
      const r = this.elementScreenRect(id);
      const host = this.app?.canvas.getBoundingClientRect();
      if (!r || !host) return null;
      // The frame: the header strip's empty end. The text: inside the body, near its start.
      const pt = part === "frame" ? { x: r.x + r.w - Math.min(12, r.w / 4), y: r.y + Math.min(6, r.h / 4) } : { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      return { x: host.left + pt.x, y: host.top + pt.y };
    };
  }

  destroy(): void {
    this.cameraListeners.clear();
    this.resizeObserver?.disconnect();
    // The viewport first: it unregisters from the app's ticker, which the app destroys.
    this.viewport?.destroy({ children: true });
    this.app?.destroy(true, { children: true });
    this.app = null;
    this.viewport = null;
    // Only this renderer's hooks: a newer renderer may already have installed its own.
    if (window.__farabiCanvasDebug === this.hooks.debug) delete window.__farabiCanvasDebug;
    if (window.__farabiScreenPoint === this.hooks.point) delete window.__farabiScreenPoint;
  }
}

function groupByTree(elements: DrawElement[]): Map<string, DrawElement[]> {
  const out = new Map<string, DrawElement[]>();
  for (const e of elements) {
    const list = out.get(e.treeId);
    if (list) list.push(e);
    else out.set(e.treeId, [e]);
  }
  return out;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
