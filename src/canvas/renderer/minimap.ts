// The minimap (FR-027, SC-012): a fixed 220×160 panel at the bottom-right of the canvas. Every
// element is a 1–2 px point coloured by its tree, each tree has a faint region, and the viewport is
// a rectangle. Clicking centres the camera there and dragging moves it continuously; both count as
// manual moves. It is its own small 2D canvas stacked above the text layer, so text never covers it.

export const MINIMAP = { w: 220, h: 160, margin: 12, pad: 8 };

const TREE_COLORS = ["#3b5bdb", "#2b8a3e", "#e8590c", "#7048e8", "#c2255c", "#0c8599", "#5c940d", "#e67700"];

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

export class Minimap {
  readonly el: HTMLCanvasElement;
  private dots: HTMLCanvasElement;
  private bounds: Bounds | null = null;
  private scale = 1;
  private offset = { x: 0, y: 0 };
  private viewport: Rect | null = null;
  private ratio = 1;

  constructor(
    host: HTMLElement,
    private readonly onMove: (world: Point) => void,
    private readonly colors: { bg: string; border: string; view: string },
  ) {
    const doc = host.ownerDocument;
    this.ratio = window.devicePixelRatio || 1;
    this.el = doc.createElement("canvas");
    this.el.className = "minimap";
    this.el.dataset.testid = "minimap";
    this.el.dataset.overlay = "";
    this.el.setAttribute("aria-label", "Minimap: click or drag to move the view");
    this.el.width = MINIMAP.w * this.ratio;
    this.el.height = MINIMAP.h * this.ratio;
    this.el.style.width = `${MINIMAP.w}px`;
    this.el.style.height = `${MINIMAP.h}px`;
    this.dots = doc.createElement("canvas");
    this.dots.width = this.el.width;
    this.dots.height = this.el.height;
    host.appendChild(this.el);

    // A press starts on the panel; the drag follows the pointer anywhere until it is released.
    const at = (e: PointerEvent) => {
      const r = this.el.getBoundingClientRect();
      return this.toWorld({ x: e.clientX - r.left, y: e.clientY - r.top });
    };
    const move = (e: PointerEvent) => this.onMove(at(e));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    this.el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.bounds) return;
      e.preventDefault();
      e.stopPropagation();
      this.onMove(at(e));
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
    });
    this.el.addEventListener("wheel", (e) => e.stopPropagation());
    this.paint();
  }

  setVisible(visible: boolean): void {
    this.el.hidden = !visible;
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  /** Redraws the points and regions; elements are boxes in world units, with their tree. */
  draw(elements: Array<{ treeId: string; x: number; y: number; w: number; h: number }>, trees: Map<string, Bounds>): void {
    this.bounds = null;
    for (const b of trees.values()) {
      this.bounds = this.bounds
        ? { minX: Math.min(this.bounds.minX, b.minX), minY: Math.min(this.bounds.minY, b.minY), maxX: Math.max(this.bounds.maxX, b.maxX), maxY: Math.max(this.bounds.maxY, b.maxY) }
        : { ...b };
    }
    const ctx = this.dots.getContext("2d")!;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.clearRect(0, 0, MINIMAP.w, MINIMAP.h);
    if (this.bounds) {
      const inner = { w: MINIMAP.w - MINIMAP.pad * 2, h: MINIMAP.h - MINIMAP.pad * 2 };
      const bw = Math.max(1, this.bounds.maxX - this.bounds.minX);
      const bh = Math.max(1, this.bounds.maxY - this.bounds.minY);
      this.scale = Math.min(inner.w / bw, inner.h / bh);
      this.offset = {
        x: MINIMAP.pad + (inner.w - bw * this.scale) / 2 - this.bounds.minX * this.scale,
        y: MINIMAP.pad + (inner.h - bh * this.scale) / 2 - this.bounds.minY * this.scale,
      };
      const colorOf = new Map([...trees.keys()].map((id, i) => [id, TREE_COLORS[i % TREE_COLORS.length]]));
      for (const [id, b] of trees) {
        const a = this.toMini({ x: b.minX, y: b.minY });
        const z = this.toMini({ x: b.maxX, y: b.maxY });
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = colorOf.get(id)!;
        ctx.fillRect(a.x - 2, a.y - 2, z.x - a.x + 4, z.y - a.y + 4);
      }
      ctx.globalAlpha = 1;
      for (const el of elements) {
        const p = this.toMini({ x: el.x + el.w / 2, y: el.y + el.h / 2 });
        const size = Math.max(1, Math.min(2, el.h * this.scale));
        ctx.fillStyle = colorOf.get(el.treeId) ?? "#999";
        ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
      }
    }
    this.paint();
  }

  /** The viewport rectangle, in world units. */
  drawViewport(world: Rect): void {
    this.viewport = world;
    this.paint();
  }

  worldBounds(): Bounds | null {
    return this.bounds;
  }

  destroy(): void {
    this.el.remove();
  }

  private paint(): void {
    const ctx = this.el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.el.width, this.el.height);
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.fillStyle = this.colors.bg;
    ctx.strokeStyle = this.colors.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(0.5, 0.5, MINIMAP.w - 1, MINIMAP.h - 1, 10);
    ctx.fill();
    ctx.stroke();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.dots, 0, 0);
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    if (!this.bounds || !this.viewport) return;
    const a = this.toMini({ x: this.viewport.x, y: this.viewport.y });
    const w = Math.max(3, this.viewport.w * this.scale);
    const h = Math.max(3, this.viewport.h * this.scale);
    // Clamped to the panel, so a far-away camera still shows where it is.
    const x = Math.min(Math.max(a.x, -w + 4), MINIMAP.w - 4);
    const y = Math.min(Math.max(a.y, -h + 4), MINIMAP.h - 4);
    ctx.strokeStyle = this.colors.view;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
  }

  private toMini(p: Point): Point {
    return { x: p.x * this.scale + this.offset.x, y: p.y * this.scale + this.offset.y };
  }

  private toWorld(p: Point): Point {
    return { x: (p.x - this.offset.x) / this.scale, y: (p.y - this.offset.y) / this.scale };
  }
}
