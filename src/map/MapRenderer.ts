// Imperative PixiJS scene for the map (research R5). React mounts it once and drives it through
// methods; nothing here re-renders through React.
import { Application, BitmapText, Container, type FederatedPointerEvent, Graphics, Rectangle } from "pixi.js";
import { Viewport } from "pixi-viewport";
import type { ForestResponse, Summary } from "@/shared/schemas";
import { buildForestGraph, type ForestGraph } from "./forestGraph";
import { type ForestLayout, layoutForest, type LayoutCache } from "./layout/forestLayout";
import { NODE_HEIGHT, NODE_WIDTH } from "./layout/treeLayout";

type Palette = {
  bg: number; edge: number; rootFill: number; rootText: number; branchFill: number;
  branchStroke: number; text: number; muted: number; ai: number; focus: number; edgeLabel: number;
};

const LIGHT: Palette = {
  bg: 0xf7f7f5, edge: 0xb8b8b0, rootFill: 0x3b5bdb, rootText: 0xffffff, branchFill: 0xffffff,
  branchStroke: 0x9aa5c9, text: 0x1d1d1f, muted: 0x6b6b70, ai: 0x7048e8, focus: 0xfab005, edgeLabel: 0x1d1d1f,
};
const DARK: Palette = {
  bg: 0x161618, edge: 0xffffff, rootFill: 0x5c7cfa, rootText: 0xffffff, branchFill: 0x1f1f22,
  branchStroke: 0x5a6390, text: 0xececec, muted: 0x9a9aa0, ai: 0x9775fa, focus: 0xfab005, edgeLabel: 0xffffff,
};

type NodeSprite = {
  id: string;
  container: Container;
  box: Graphics;
  label: BitmapText;
  tag: BitmapText;
  isRoot: boolean;
  /** Box height, grown to fit the text. */
  height: number;
};

export type MapDebug = {
  nodes: Array<{ id: string; treeId: string; x: number; y: number; isRoot: boolean; labelKind: Summary["kind"]; label: string }>;
  edges: Array<{ from: string; to: string; label: string | null }>;
  treeBoxes: Record<string, { minX: number; minY: number; maxX: number; maxY: number }>;
};

declare global {
  interface Window {
    __farabiMapDebug?: MapDebug;
    /** Test hook: page coordinates of a node's centre, for clicking it on the canvas. */
    __farabiMapScreenPoint?: (nodeId: string) => { x: number; y: number } | null;
    /** Test hook: page coordinates of the middle of the edge into `childId` (for clicking it). */
    __farabiMapEdgePoint?: (childId: string) => { x: number; y: number } | null;
    /** Test hook: the node under a page point, as PixiJS hit-testing sees it. */
    __farabiMapHitTest?: (x: number, y: number) => string | null;
  }
}

/** Labels are drawn only when zoomed in enough to read them (FR-024). */
const LABEL_MIN_ZOOM = 0.5;
const LABEL_MAX_CHARS = 40;
const LABEL_FONT_SIZE = 14;
/** Space kept between a node's text and its box edge. */
const BOX_PADDING = 10;
/** How close (screen px) a click must be to an edge to select it. */
const EDGE_HIT_PX = 8;

type Point = { x: number; y: number };

/**
 * The edge from parent a to child b: a cubic curve from a's bottom to b's top. Boxes grow down to
 * fit their text, so the parent's bottom depends on its height.
 */
function edgeCurve(a: Point, b: Point, parentHeight = NODE_HEIGHT): [Point, Point, Point, Point] {
  const p0 = { x: a.x, y: a.y - NODE_HEIGHT / 2 + parentHeight };
  const p3 = { x: b.x, y: b.y - NODE_HEIGHT / 2 };
  const midY = (p0.y + p3.y) / 2;
  return [p0, { x: a.x, y: midY }, { x: b.x, y: midY }, p3];
}

function curvePoint([p0, p1, p2, p3]: [Point, Point, Point, Point], t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Two clicks on the same node within this time open it. */
const DOUBLE_CLICK_MS = 350;
/** How far "zooming into" a node goes, relative to the resting zoom. */
const ZOOM_INTO_FACTOR = 3;
const ZOOM_IN_MS = 380;
const ZOOM_OUT_MS = 450;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Movement (screen px) that turns a press into a drag; less than this is a click (FR-022). */
const DRAG_THRESHOLD = 4;

type DragState = {
  nodeId: string;
  treeId: string;
  isRoot: boolean;
  startScreen: { x: number; y: number };
  startWorld: { x: number; y: number };
  /** World positions at drag start of the nodes being moved. */
  startPositions: Map<string, { x: number; y: number }>;
  dragging: boolean;
};

export class MapRenderer {
  private app: Application | null = null;
  private viewport: Viewport | null = null;
  private edgeLayer = new Graphics();
  private labelLayer = new Container();
  private edgeLabels = new Map<string, { group: Container; bg: Graphics; text: BitmapText }>();
  /** Current box height per node; boxes grow to fit their text. */
  private nodeHeights = new Map<string, number>();
  private edgeClickHandler: ((childId: string, screen: Point) => void) | null = null;
  private nodeLayer = new Container();
  private sprites = new Map<string, NodeSprite>();
  private forest: ForestResponse | null = null;
  private graph: ForestGraph | null = null;
  private layout: ForestLayout | null = null;
  private cache: LayoutCache = new Map();
  private palette: Palette = LIGHT;
  private openHandler: ((id: string) => void) | null = null;
  private lastClick: { id: string; time: number } | null = null;
  /** The zoom to return to when zooming back out of a node. */
  private restScale: number | null = null;
  private nodeMovedHandler: ((nodeId: string, relX: number, relY: number) => void) | null = null;
  private treeMovedHandler: ((treeId: string, x: number, y: number) => void) | null = null;
  private drag: DragState | null = null;
  private focused: string | null = null;
  private centered = false;

  async mount(el: HTMLElement): Promise<void> {
    this.palette = window.matchMedia("(prefers-color-scheme: dark)").matches ? DARK : LIGHT;
    const app = new Application();
    await app.init({
      resizeTo: el,
      background: this.palette.bg,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    el.appendChild(app.canvas);
    const viewport = new Viewport({
      screenWidth: el.clientWidth,
      screenHeight: el.clientHeight,
      events: app.renderer.events,
      // A fixed, very large hit area. The default one tracks the visible region and is refreshed
      // only on the next tick, so right after a programmatic move nodes outside the old view
      // couldn't be clicked.
      forceHitArea: new Rectangle(-1e7, -1e7, 2e7, 2e7),
    });
    viewport.drag().pinch().wheel().decelerate().clampZoom({ minScale: 0.1, maxScale: 3 });
    viewport.addChild(this.edgeLayer, this.labelLayer, this.nodeLayer);
    viewport.on("zoomed", () => this.updateLabelVisibility());
    // A click on the background near an edge selects that edge (FR-023). Node presses stop
    // propagation, so this only fires for clicks that miss every node.
    viewport.on("clicked", (e) => this.handleBackgroundClick(e.world, e.screen));
    app.stage.addChild(viewport);
    app.renderer.on("resize", (w: number, h: number) => viewport.resize(w, h));
    this.app = app;
    this.viewport = viewport;
    if (this.forest) this.render(new Set(this.forest.trees.map((t) => t.id)));
  }

  /** A node was double-clicked: open its conversation. A single click only selects it. */
  onNodeOpen(cb: (nodeId: string) => void): void {
    this.openHandler = cb;
  }

  /** Centre of a node's box in world coordinates. */
  private nodeCenter(nodeId: string): Point | null {
    const p = this.layout?.positions.get(nodeId);
    if (!p) return null;
    return { x: p.x, y: p.y - NODE_HEIGHT / 2 + this.heightOf(nodeId) / 2 };
  }

  /** Zooms down into a node (before opening its conversation). Resolves when finished. */
  zoomInto(nodeId: string): Promise<void> {
    const viewport = this.viewport;
    const center = this.nodeCenter(nodeId);
    if (!viewport || !center) return Promise.resolve();
    this.restScale = viewport.scale.x;
    this.focusOnly(nodeId);
    if (prefersReducedMotion()) return Promise.resolve();
    return new Promise((resolve) => {
      const done = setTimeout(resolve, ZOOM_IN_MS + 200); // never leave the user waiting
      viewport.plugins.remove("animate");
      viewport.animate({
        position: center,
        scale: this.restScale! * ZOOM_INTO_FACTOR,
        time: ZOOM_IN_MS,
        ease: "easeInQuad",
        removeOnInterrupt: true,
        callbackOnComplete: () => {
          clearTimeout(done);
          resolve();
        },
      });
    });
  }

  /**
   * Zooms out to the map with a node in focus (returning from its conversation). Starts close in
   * on the node and eases out to the zoom the user had before.
   */
  zoomOutTo(nodeId: string | null): void {
    const viewport = this.viewport;
    const center = nodeId ? this.nodeCenter(nodeId) : null;
    if (!viewport || !center) return;
    this.focusOnly(nodeId);
    const target = this.restScale ?? viewport.scale.x;
    this.restScale = null;
    viewport.plugins.remove("animate");
    if (prefersReducedMotion()) {
      viewport.setZoom(target, true);
      viewport.moveCenter(center.x, center.y);
      return;
    }
    viewport.setZoom(target * ZOOM_INTO_FACTOR, true);
    viewport.moveCenter(center.x, center.y);
    viewport.animate({ position: center, scale: target, time: ZOOM_OUT_MS, ease: "easeOutCubic", removeOnInterrupt: true });
  }

  /** Highlights one node without moving the view. */
  private focusOnly(nodeId: string | null): void {
    this.focused = nodeId;
    for (const [id, sprite] of this.sprites) this.drawBox(sprite, id === nodeId);
  }

  /** A non-root node was dragged; position is relative to its tree's origin (FR-016, FR-017). */
  onNodeMoved(cb: (nodeId: string, relX: number, relY: number) => void): void {
    this.nodeMovedHandler = cb;
  }

  /** An edge was clicked; `screen` is the click point in page coordinates. */
  onEdgeClick(cb: (childId: string, screen: Point) => void): void {
    this.edgeClickHandler = cb;
  }

  /** Shows a label change at once, before the next poll brings it back from the server. */
  setEdgeLabel(childId: string, text: string | null): void {
    if (!this.forest || !this.graph) return;
    this.forest = {
      ...this.forest,
      nodes: this.forest.nodes.map((n) => (n.id === childId ? { ...n, edgeLabel: text } : n)),
    };
    if (this.graph.hasNode(childId)) this.graph.setNodeAttribute(childId, "edgeLabel", text);
    this.drawEdges();
    this.publishDebug();
  }

  /** Redraws edge labels after a poll found label changes. */
  updateEdgeLabels(forest: ForestResponse): void {
    for (const n of forest.nodes) {
      const current = this.forest?.nodes.find((m) => m.id === n.id);
      if (current && current.edgeLabel !== n.edgeLabel) this.setEdgeLabel(n.id, n.edgeLabel);
    }
  }

  /** A tree was dragged by its root; x/y is the tree's new origin (FR-015). */
  onTreeMoved(cb: (treeId: string, x: number, y: number) => void): void {
    this.treeMovedHandler = cb;
  }

  /**
   * Replaces the forest. Only trees in `changedTreeIds` are laid out again; returns trees that had
   * to move because they outgrew their region (to persist).
   */
  setForest(forest: ForestResponse, changedTreeIds: Set<string>): ForestLayout["relocations"] {
    this.forest = forest;
    this.graph = buildForestGraph(forest);
    return this.render(changedTreeIds);
  }

  /**
   * Updates node labels in place. A label that changes a box's height re-lays out that tree;
   * returns any trees that had to move (to persist), as setForest does.
   */
  updateSummaries(changes: Array<{ id: string; summary: Summary }>): ForestLayout["relocations"] {
    if (!this.forest || !this.graph) return [];
    const byId = new Map(changes.map((c) => [c.id, c.summary]));
    this.forest = {
      ...this.forest,
      nodes: this.forest.nodes.map((n) => (byId.has(n.id) ? { ...n, summary: byId.get(n.id)! } : n)),
    };
    for (const { id, summary } of changes) {
      if (this.graph.hasNode(id)) this.graph.setNodeAttribute(id, "summary", summary);
    }
    return this.render(new Set());
  }

  destroy(): void {
    this.app?.destroy(true, { children: true });
    this.app = null;
    this.viewport = null;
    delete window.__farabiMapDebug;
    delete window.__farabiMapScreenPoint;
    delete window.__farabiMapHitTest;
    delete window.__farabiMapEdgePoint;
  }

  private render(changedTreeIds: Set<string>): ForestLayout["relocations"] {
    if (!this.forest || !this.graph) return [];
    // Size every box from its text first; a tree whose box heights changed is laid out again.
    const changed = new Set(changedTreeIds);
    if (this.app) {
      for (const treeId of this.prepareSprites()) changed.add(treeId);
    }
    const layout = layoutForest(this.graph, this.forest.trees, changed, this.cache, this.nodeHeights);
    this.layout = layout;
    if (this.app) {
      this.drawNodes();
      this.drawEdges();
      if (!this.centered && this.viewport && layout.positions.size > 0) {
        const first = layout.positions.values().next().value!;
        this.viewport.moveCenter(first.x, first.y + 150);
        this.centered = true;
      }
    }
    this.publishDebug();
    return layout.relocations;
  }

  private drawEdges(): void {
    const g = this.edgeLayer;
    g.clear();
    if (!this.graph || !this.layout) return;
    const labelled = new Set<string>();
    this.graph.forEachEdge((_edge, _attrs, source, target) => {
      const a = this.layout!.positions.get(source);
      const b = this.layout!.positions.get(target);
      if (!a || !b) return;
      const curve = edgeCurve(a, b, this.heightOf(source));
      g.moveTo(curve[0].x, curve[0].y)
        .bezierCurveTo(curve[1].x, curve[1].y, curve[2].x, curve[2].y, curve[3].x, curve[3].y)
        .stroke({ width: 2, color: this.palette.edge });
      const label = this.graph!.getNodeAttribute(target, "edgeLabel");
      if (label) {
        labelled.add(target);
        this.drawEdgeLabel(target, label, curvePoint(curve, 0.5));
      }
    });
    for (const [id, entry] of this.edgeLabels) {
      if (!labelled.has(id)) {
        entry.group.destroy({ children: true });
        this.edgeLabels.delete(id);
      }
    }
    this.updateLabelVisibility();
  }

  private drawEdgeLabel(childId: string, label: string, at: Point): void {
    let entry = this.edgeLabels.get(childId);
    if (!entry) {
      const group = new Container();
      // Filled with the canvas colour so the edge line disappears behind the text.
      const bg = new Graphics();
      const text = new BitmapText({
        text: "",
        style: { fontFamily: "system-ui, sans-serif", fontSize: LABEL_FONT_SIZE, fill: this.palette.edgeLabel },
      });
      text.anchor.set(0.5);
      group.addChild(bg, text);
      entry = { group, bg, text };
      this.edgeLabels.set(childId, entry);
      this.labelLayer.addChild(group);
    }
    entry.text.text = label.length > LABEL_MAX_CHARS ? `${label.slice(0, LABEL_MAX_CHARS - 1)}…` : label;
    const w = entry.text.width + 12;
    const h = entry.text.height + 6;
    entry.bg.clear().roundRect(-w / 2, -h / 2, w, h, 4).fill({ color: this.palette.bg });
    entry.group.position.set(at.x, at.y);
  }

  private heightOf(nodeId: string): number {
    return this.nodeHeights.get(nodeId) ?? NODE_HEIGHT;
  }

  private updateLabelVisibility(): void {
    if (this.viewport) this.labelLayer.visible = this.viewport.scale.x >= LABEL_MIN_ZOOM;
  }

  /** The edge (by child id) closest to a world point, if within EDGE_HIT_PX on screen. */
  private edgeAt(world: Point): string | null {
    if (!this.graph || !this.layout || !this.viewport) return null;
    const limit = EDGE_HIT_PX / this.viewport.scale.x;
    let best: { id: string; d: number } | null = null;
    this.graph.forEachEdge((_edge, _attrs, source, target) => {
      const a = this.layout!.positions.get(source);
      const b = this.layout!.positions.get(target);
      if (!a || !b) return;
      const curve = edgeCurve(a, b, this.heightOf(source));
      let prev = curve[0];
      for (let i = 1; i <= 16; i++) {
        const next = curvePoint(curve, i / 16);
        const d = distanceToSegment(world, prev, next);
        if (d <= limit && (!best || d < best.d)) best = { id: target, d };
        prev = next;
      }
    });
    return (best as { id: string; d: number } | null)?.id ?? null;
  }

  private handleBackgroundClick(world: Point, screen: Point): void {
    const childId = this.edgeAt(world);
    if (!childId || !this.app) return;
    const rect = this.app.canvas.getBoundingClientRect();
    this.edgeClickHandler?.(childId, { x: rect.left + screen.x, y: rect.top + screen.y });
  }

  /**
   * Creates or updates every node's sprite and label, and so its box height. Returns the trees
   * where a box height changed (their layout must be recomputed).
   */
  private prepareSprites(): Set<string> {
    const changedTrees = new Set<string>();
    if (!this.forest) return changedTrees;
    const seen = new Set<string>();
    for (const node of this.forest.nodes) {
      seen.add(node.id);
      let sprite = this.sprites.get(node.id);
      if (!sprite) {
        sprite = this.createSprite(node.id, node.isRoot);
        this.sprites.set(node.id, sprite);
        this.nodeLayer.addChild(sprite.container);
      }
      const before = this.nodeHeights.get(node.id);
      this.applyLabel(sprite, node.summary);
      if (before !== undefined && before !== sprite.height) changedTrees.add(node.treeId);
    }
    for (const [id, sprite] of this.sprites) {
      if (!seen.has(id)) {
        sprite.container.destroy({ children: true });
        this.sprites.delete(id);
        this.nodeHeights.delete(id);
      }
    }
    return changedTrees;
  }

  /** Places every sprite at its laid-out position and draws its box. */
  private drawNodes(): void {
    if (!this.forest || !this.layout) return;
    for (const node of this.forest.nodes) {
      const p = this.layout.positions.get(node.id);
      const sprite = this.sprites.get(node.id);
      if (!p || !sprite) continue;
      sprite.container.position.set(p.x - NODE_WIDTH / 2, p.y - NODE_HEIGHT / 2);
      this.drawBox(sprite, node.id === this.focused);
    }
  }

  private createSprite(id: string, isRoot: boolean): NodeSprite {
    const container = new Container();
    container.eventMode = "static";
    container.cursor = "pointer";
    const box = new Graphics();
    // BitmapText draws from one shared glyph atlas, so hundreds of labels stay cheap (SC-006).
    const tag = new BitmapText({
      text: "AI",
      style: { fontFamily: "system-ui, sans-serif", fontSize: 10, fontWeight: "700", fill: this.palette.ai },
    });
    tag.position.set(10, 8);
    const label = new BitmapText({
      text: "",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
        fill: this.palette.text,
        wordWrap: true,
        // Long words (URLs, identifiers) wrap too, so no text runs past the box.
        breakWords: true,
        wordWrapWidth: NODE_WIDTH - 2 * BOX_PADDING,
        lineHeight: 16,
      },
    });
    label.position.set(10, 22);
    container.addChild(box, tag, label);

    container.on("pointerdown", (e) => this.startDrag(id, e));
    container.on("globalpointermove", (e) => this.moveDrag(id, e));
    container.on("pointerup", (e) => this.endDrag(id, e));
    container.on("pointerupoutside", (e) => this.endDrag(id, e));
    return { id, container, box, label, tag, isRoot, height: NODE_HEIGHT };
  }

  private startDrag(id: string, e: FederatedPointerEvent): void {
    if (!this.graph || !this.layout || !this.viewport || !this.forest) return;
    // Keep the press on the node; the viewport must not start panning (FR-021).
    e.stopPropagation();
    const treeId = this.graph.getNodeAttribute(id, "treeId");
    const isRoot = this.graph.getNodeAttribute(id, "isRoot");
    const moving = isRoot
      ? this.forest.nodes.filter((n) => n.treeId === treeId).map((n) => n.id)
      : [id];
    const startPositions = new Map(moving.map((nid) => [nid, { ...this.layout!.positions.get(nid)! }]));
    this.drag = {
      nodeId: id,
      treeId,
      isRoot,
      startScreen: { x: e.global.x, y: e.global.y },
      startWorld: this.viewport.toWorld(e.global.x, e.global.y),
      startPositions,
      dragging: false,
    };
  }

  private moveDrag(id: string, e: FederatedPointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.nodeId !== id || !this.viewport || !this.layout) return;
    if (!drag.dragging) {
      if (Math.hypot(e.global.x - drag.startScreen.x, e.global.y - drag.startScreen.y) < DRAG_THRESHOLD) return;
      drag.dragging = true;
    }
    const world = this.viewport.toWorld(e.global.x, e.global.y);
    const dx = world.x - drag.startWorld.x;
    const dy = world.y - drag.startWorld.y;
    // Only visual state changes while dragging; nothing is saved until release.
    for (const [nid, start] of drag.startPositions) {
      const p = { x: start.x + dx, y: start.y + dy };
      this.layout.positions.set(nid, p);
      this.sprites.get(nid)?.container.position.set(p.x - NODE_WIDTH / 2, p.y - NODE_HEIGHT / 2);
    }
    this.drawEdges();
  }

  private endDrag(id: string, e: FederatedPointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.nodeId !== id) return;
    this.drag = null;
    if (!drag.dragging) {
      if (Math.hypot(e.global.x - drag.startScreen.x, e.global.y - drag.startScreen.y) < DRAG_THRESHOLD) {
        const now = performance.now();
        if (this.lastClick?.id === id && now - this.lastClick.time < DOUBLE_CLICK_MS) {
          this.lastClick = null;
          this.openHandler?.(id);
        } else {
          this.lastClick = { id, time: now };
          this.focusOnly(id); // a single click selects
        }
      }
      return;
    }
    this.commitDrag(drag);
  }

  /** Stores a finished drag in the renderer's own state, then reports it for saving. */
  private commitDrag(drag: DragState): void {
    if (!this.forest || !this.layout || !this.graph) return;
    const tree = this.forest.trees.find((t) => t.id === drag.treeId);
    if (!tree) return;
    const moved = this.layout.positions.get(drag.nodeId)!;
    const start = drag.startPositions.get(drag.nodeId)!;
    if (drag.isRoot) {
      const origin = { x: tree.origin.x + moved.x - start.x, y: tree.origin.y + moved.y - start.y };
      this.forest = {
        ...this.forest,
        trees: this.forest.trees.map((t) => (t.id === tree.id ? { ...t, origin, userPlaced: true } : t)),
      };
      const box = this.layout.boxes.get(tree.id);
      if (box) {
        const dx = moved.x - start.x;
        const dy = moved.y - start.y;
        this.layout.boxes.set(tree.id, { minX: box.minX + dx, maxX: box.maxX + dx, minY: box.minY + dy, maxY: box.maxY + dy });
      }
      this.treeMovedHandler?.(tree.id, origin.x, origin.y);
    } else {
      const rel = { x: moved.x - tree.origin.x, y: moved.y - tree.origin.y };
      this.forest = {
        ...this.forest,
        nodes: this.forest.nodes.map((n) => (n.id === drag.nodeId ? { ...n, manual: rel } : n)),
      };
      this.graph.setNodeAttribute(drag.nodeId, "manual", rel);
      this.cache.get(tree.id)?.positions.set(drag.nodeId, rel);
      this.nodeMovedHandler?.(drag.nodeId, rel.x, rel.y);
    }
    this.publishDebug();
  }

  private drawBox(sprite: NodeSprite, focused: boolean): void {
    const { box, isRoot } = sprite;
    box.clear();
    // Roots are filled, larger-radius blocks; branches are outlined cards (FR-019).
    box.roundRect(0, 0, NODE_WIDTH, sprite.height, isRoot ? 14 : 6).fill({
      color: isRoot ? this.palette.rootFill : this.palette.branchFill,
    });
    box.stroke({
      width: focused ? 3 : isRoot ? 0 : 1.5,
      color: focused ? this.palette.focus : this.palette.branchStroke,
    });
  }

  private applyLabel(sprite: NodeSprite, summary: Summary): void {
    const isAi = summary.kind === "summary";
    // The whole label is shown; the box grows to fit it.
    sprite.label.text = summary.text;
    // AI summaries carry an "AI" tag; placeholders are muted italic with no tag (FR-011, FR-014).
    sprite.tag.visible = isAi;
    sprite.tag.style.fill = sprite.isRoot ? this.palette.rootText : this.palette.ai;
    sprite.label.position.y = isAi ? 22 : 14;
    sprite.label.style.fontStyle = isAi ? "normal" : "italic";
    sprite.label.style.fill = sprite.isRoot
      ? this.palette.rootText
      : isAi
        ? this.palette.text
        : this.palette.muted;
    // The box grows to hold every line of text (never shorter than the standard height).
    sprite.height = Math.max(NODE_HEIGHT, Math.ceil(sprite.label.position.y + sprite.label.height + BOX_PADDING));
    this.nodeHeights.set(sprite.id, sprite.height);
  }

  private publishDebug(): void {
    const testHooks =
      process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_FARABI_TEST_HOOKS === "1";
    if (!testHooks || typeof window === "undefined") return;
    if (!this.forest || !this.layout || !this.graph) return;
    const layout = this.layout;
    window.__farabiMapDebug = {
      nodes: this.forest.nodes.map((n) => ({
        id: n.id,
        treeId: n.treeId,
        x: layout.positions.get(n.id)?.x ?? NaN,
        y: layout.positions.get(n.id)?.y ?? NaN,
        isRoot: n.isRoot,
        labelKind: n.summary.kind,
        label: n.summary.text,
      })),
      edges: this.graph.mapEdges((_e, _a, from, to) => ({
        from,
        to,
        label: this.graph!.getNodeAttribute(to, "edgeLabel"),
      })),
      treeBoxes: Object.fromEntries(layout.boxes),
    };
    window.__farabiMapScreenPoint = (nodeId) => {
      const p = this.layout?.positions.get(nodeId);
      if (!p || !this.viewport || !this.app) return null;
      this.viewport.plugins.remove("animate");
      this.viewport.moveCenter(p.x, p.y);
      // Render now so hit-testing uses the new transforms; otherwise a click that arrives before
      // the next frame is tested against the old positions and misses.
      this.app.render();
      const screen = this.viewport.toScreen(p.x, p.y);
      const rect = this.app.canvas.getBoundingClientRect();
      return { x: rect.left + screen.x, y: rect.top + screen.y };
    };
    window.__farabiMapEdgePoint = (childId) => {
      const parent = this.graph?.hasNode(childId) ? this.graph.inNeighbors(childId)[0] : undefined;
      const a = parent ? this.layout?.positions.get(parent) : undefined;
      const b = this.layout?.positions.get(childId);
      if (!a || !b || !this.viewport || !this.app) return null;
      const mid = curvePoint(edgeCurve(a, b, this.heightOf(parent!)), 0.5);
      this.viewport.plugins.remove("animate");
      this.viewport.moveCenter(mid.x, mid.y);
      this.app.render();
      const screen = this.viewport.toScreen(mid.x, mid.y);
      const rect = this.app.canvas.getBoundingClientRect();
      return { x: rect.left + screen.x, y: rect.top + screen.y };
    };
    window.__farabiMapHitTest = (x, y) => {
      if (!this.app) return null;
      const rect = this.app.canvas.getBoundingClientRect();
      let hit: Container | null = this.app.renderer.events.rootBoundary.hitTest(x - rect.left, y - rect.top);
      while (hit) {
        for (const [id, sprite] of this.sprites) if (sprite.container === hit) return id;
        hit = hit.parent;
      }
      return null;
    };
  }
}
