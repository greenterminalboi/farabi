// Imperative PixiJS scene for the map (research R5). React mounts it once and drives it through
// methods; nothing here re-renders through React.
import { Application, BitmapText, Container, Graphics } from "pixi.js";
import { Viewport } from "pixi-viewport";
import type { ForestResponse, Summary } from "@/shared/schemas";
import { buildForestGraph, type ForestGraph } from "./forestGraph";
import { type ForestLayout, layoutForest, type LayoutCache } from "./layout/forestLayout";
import { NODE_HEIGHT, NODE_WIDTH } from "./layout/treeLayout";

type Palette = {
  bg: number; edge: number; rootFill: number; rootText: number; branchFill: number;
  branchStroke: number; text: number; muted: number; ai: number; focus: number;
};

const LIGHT: Palette = {
  bg: 0xf7f7f5, edge: 0xb8b8b0, rootFill: 0x3b5bdb, rootText: 0xffffff, branchFill: 0xffffff,
  branchStroke: 0x9aa5c9, text: 0x1d1d1f, muted: 0x6b6b70, ai: 0x7048e8, focus: 0xfab005,
};
const DARK: Palette = {
  bg: 0x161618, edge: 0x4a4a52, rootFill: 0x5c7cfa, rootText: 0xffffff, branchFill: 0x1f1f22,
  branchStroke: 0x5a6390, text: 0xececec, muted: 0x9a9aa0, ai: 0x9775fa, focus: 0xfab005,
};

type NodeSprite = { container: Container; box: Graphics; label: BitmapText; tag: BitmapText; isRoot: boolean };

export type MapDebug = {
  nodes: Array<{ id: string; treeId: string; x: number; y: number; isRoot: boolean; labelKind: Summary["kind"]; label: string }>;
  edges: Array<{ from: string; to: string }>;
  treeBoxes: Record<string, { minX: number; minY: number; maxX: number; maxY: number }>;
};

declare global {
  interface Window {
    __farabiMapDebug?: MapDebug;
    /** Test hook: page coordinates of a node's centre, for clicking it on the canvas. */
    __farabiMapScreenPoint?: (nodeId: string) => { x: number; y: number } | null;
  }
}

const CLICK_SLOP = 5;

export class MapRenderer {
  private app: Application | null = null;
  private viewport: Viewport | null = null;
  private edgeLayer = new Graphics();
  private nodeLayer = new Container();
  private sprites = new Map<string, NodeSprite>();
  private forest: ForestResponse | null = null;
  private graph: ForestGraph | null = null;
  private layout: ForestLayout | null = null;
  private cache: LayoutCache = new Map();
  private palette: Palette = LIGHT;
  private clickHandler: ((id: string) => void) | null = null;
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
    });
    viewport.drag().pinch().wheel().decelerate().clampZoom({ minScale: 0.1, maxScale: 3 });
    viewport.addChild(this.edgeLayer, this.nodeLayer);
    app.stage.addChild(viewport);
    app.renderer.on("resize", (w: number, h: number) => viewport.resize(w, h));
    this.app = app;
    this.viewport = viewport;
    if (this.forest) this.render(new Set(this.forest.trees.map((t) => t.id)));
  }

  onNodeClick(cb: (nodeId: string) => void): void {
    this.clickHandler = cb;
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

  updateSummaries(changes: Array<{ id: string; summary: Summary }>): void {
    if (!this.forest) return;
    const byId = new Map(changes.map((c) => [c.id, c.summary]));
    this.forest = {
      ...this.forest,
      nodes: this.forest.nodes.map((n) => (byId.has(n.id) ? { ...n, summary: byId.get(n.id)! } : n)),
    };
    for (const { id, summary } of changes) {
      const sprite = this.sprites.get(id);
      if (sprite) this.applyLabel(sprite, summary);
    }
    this.publishDebug();
  }

  focusNode(nodeId: string | null): void {
    this.focused = nodeId;
    for (const [id, sprite] of this.sprites) this.drawBox(sprite, id === nodeId);
    const p = nodeId ? this.layout?.positions.get(nodeId) : undefined;
    if (p && this.viewport) this.viewport.moveCenter(p.x, p.y);
  }

  destroy(): void {
    this.app?.destroy(true, { children: true });
    this.app = null;
    this.viewport = null;
    delete window.__farabiMapDebug;
    delete window.__farabiMapScreenPoint;
  }

  private render(changedTreeIds: Set<string>): ForestLayout["relocations"] {
    if (!this.forest || !this.graph) return [];
    const layout = layoutForest(this.graph, this.forest.trees, changedTreeIds, this.cache);
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
    this.graph.forEachEdge((_edge, _attrs, source, target) => {
      const a = this.layout!.positions.get(source);
      const b = this.layout!.positions.get(target);
      if (!a || !b) return;
      const midY = (a.y + NODE_HEIGHT / 2 + b.y - NODE_HEIGHT / 2) / 2;
      g.moveTo(a.x, a.y + NODE_HEIGHT / 2)
        .bezierCurveTo(a.x, midY, b.x, midY, b.x, b.y - NODE_HEIGHT / 2)
        .stroke({ width: 2, color: this.palette.edge });
    });
  }

  private drawNodes(): void {
    if (!this.forest || !this.layout) return;
    const seen = new Set<string>();
    for (const node of this.forest.nodes) {
      const p = this.layout.positions.get(node.id);
      if (!p) continue;
      seen.add(node.id);
      let sprite = this.sprites.get(node.id);
      if (!sprite) {
        sprite = this.createSprite(node.id, node.isRoot);
        this.sprites.set(node.id, sprite);
        this.nodeLayer.addChild(sprite.container);
      }
      sprite.container.position.set(p.x - NODE_WIDTH / 2, p.y - NODE_HEIGHT / 2);
      this.applyLabel(sprite, node.summary);
      this.drawBox(sprite, node.id === this.focused);
    }
    for (const [id, sprite] of this.sprites) {
      if (!seen.has(id)) {
        sprite.container.destroy({ children: true });
        this.sprites.delete(id);
      }
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
        wordWrapWidth: NODE_WIDTH - 20,
        lineHeight: 16,
      },
    });
    label.position.set(10, 22);
    container.addChild(box, tag, label);

    let down: { x: number; y: number } | null = null;
    container.on("pointerdown", (e) => (down = { x: e.global.x, y: e.global.y }));
    container.on("pointerup", (e) => {
      if (down && Math.hypot(e.global.x - down.x, e.global.y - down.y) < CLICK_SLOP) this.clickHandler?.(id);
      down = null;
    });
    return { container, box, label, tag, isRoot };
  }

  private drawBox(sprite: NodeSprite, focused: boolean): void {
    const { box, isRoot } = sprite;
    box.clear();
    // Roots are filled, larger-radius blocks; branches are outlined cards (FR-019).
    box.roundRect(0, 0, NODE_WIDTH, NODE_HEIGHT, isRoot ? 14 : 6).fill({
      color: isRoot ? this.palette.rootFill : this.palette.branchFill,
    });
    box.stroke({
      width: focused ? 3 : isRoot ? 0 : 1.5,
      color: focused ? this.palette.focus : this.palette.branchStroke,
    });
  }

  private applyLabel(sprite: NodeSprite, summary: Summary): void {
    const isAi = summary.kind === "summary";
    const text = summary.text.length > 90 ? `${summary.text.slice(0, 89)}…` : summary.text;
    sprite.label.text = text;
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
      edges: this.graph.mapEdges((_e, _a, from, to) => ({ from, to })),
      treeBoxes: Object.fromEntries(layout.boxes),
    };
    window.__farabiMapScreenPoint = (nodeId) => {
      const p = this.layout?.positions.get(nodeId);
      if (!p || !this.viewport || !this.app) return null;
      this.viewport.moveCenter(p.x, p.y);
      const screen = this.viewport.toScreen(p.x, p.y);
      const rect = this.app.canvas.getBoundingClientRect();
      return { x: rect.left + screen.x, y: rect.top + screen.y };
    };
  }
}
