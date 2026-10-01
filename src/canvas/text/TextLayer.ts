// The DOM text layer over the canvas (research R7, R8; contracts/canvas-ui.md). One CSS transform,
// equal to the camera, positions every item; items hold real text, mounted only while in view (or
// pinned) and clipped to their share of a global character budget. Imperative: nothing here
// renders through React.
import { allocate, FLOOR_CHARS, TOTAL_CHARS } from "./budget";
import { type Decorate, renderBlocks } from "./render";
import { clip, richTextPrefix } from "./richText";

/** One element's text box, in world units. */
export type TextItem = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Extra classes on the item, e.g. its display ("answer", "question"). */
  className: string;
  /** The element's raw text; markdown for answers, plain for the user's own words. */
  source: string;
  markdown: boolean;
  /** Bumps when the item's text or decorations change, so a mounted item re-renders. */
  version: number;
  decorate?: Decorate | null;
};

export type Camera = { scale: number; x: number; y: number; screenWidth: number; screenHeight: number };

export type PinReason = "selection" | "composer" | "stream";

type Mounted = {
  el: HTMLElement;
  /** Characters actually rendered, and whether the text was cut. */
  chars: number;
  clipped: boolean;
  version: number;
};

export type TextStats = {
  mounted: number;
  chars: number;
  pinned: string[];
  offscreenMounted: number;
  /** Cumulative main-thread time spent by the layer, for performance checks. */
  work: { refreshMs: number; refreshes: number; renderMs: number; renders: number };
};

/** Milliseconds of DOM work per frame; the rest waits for the next frame. */
const FRAME_WORK_MS = 6;
/** The first fill has nothing on screen to keep smooth yet, so it may take longer frames. */
const FIRST_FILL_WORK_MS = 48;
/** While the camera moves, mounted items keep their text; they catch up once it rests. */
const MOVE_SETTLE_MS = 100;
/** Out-of-view items are unmounted only once the camera has been still this long. */
const UNMOUNT_IDLE_MS = 120;

export class TextLayer {
  readonly root: HTMLDivElement;
  private world: HTMLDivElement;
  private items = new Map<string, TextItem>();
  private mounted = new Map<string, Mounted>();
  private pins = new Map<string, Set<PinReason>>();
  private visible = new Set<string>();
  private wanted = new Map<string, number>();
  private queue: string[] = [];
  private frame = 0;
  private unmountTimer: ReturnType<typeof setTimeout> | null = null;
  private camera: Camera | null = null;
  private idleListeners = new Set<() => void>();
  private work = { refreshMs: 0, refreshes: 0, renderMs: 0, renders: 0 };
  private filled = false;
  private movingUntil = 0;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    host: HTMLElement,
    private readonly options: { total?: number; floor?: number; willChange?: boolean } = {},
  ) {
    const doc = host.ownerDocument;
    this.root = doc.createElement("div");
    this.root.className = "text-layer";
    this.root.dataset.testid = "text-layer";
    this.world = doc.createElement("div");
    this.world.className = "text-world";
    if (options.willChange) this.world.style.willChange = "transform";
    this.root.appendChild(this.world);
    host.appendChild(this.root);
  }

  /** The camera, written once per frame, in the same frame as the canvas render (FR-029). */
  setCamera(camera: Camera): void {
    const c = this.camera;
    if (c && (c.scale !== camera.scale || c.x !== camera.x || c.y !== camera.y)) {
      // Re-rendering hundreds of items on every pan or zoom step drops frames (M0): only mount
      // what comes into view, and resize what's already mounted once the camera rests.
      this.movingUntil = performance.now() + MOVE_SETTLE_MS;
      if (this.settleTimer) clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => {
        this.settleTimer = null;
        this.refresh();
      }, MOVE_SETTLE_MS + 10);
    }
    this.camera = camera;
    this.world.style.transform = `matrix(${camera.scale},0,0,${camera.scale},${camera.x},${camera.y})`;
    this.refresh();
  }

  /** Replaces the set of items (positions, sizes, text). */
  setItems(items: Iterable<TextItem>): void {
    this.items = new Map([...items].map((i) => [i.id, i]));
    for (const [id, m] of this.mounted) {
      const item = this.items.get(id);
      if (!item) {
        m.el.remove();
        this.mounted.delete(id);
      } else this.place(m.el, item);
    }
    this.refresh();
  }

  pin(id: string, reason: PinReason): void {
    const set = this.pins.get(id) ?? new Set();
    set.add(reason);
    this.pins.set(id, set);
    this.refresh();
  }

  unpin(id: string, reason: PinReason): void {
    const set = this.pins.get(id);
    if (!set) return;
    set.delete(reason);
    if (set.size === 0) this.pins.delete(id);
    this.refresh();
  }

  isMounted(id: string): boolean {
    return this.mounted.has(id);
  }

  element(id: string): HTMLElement | null {
    return this.mounted.get(id)?.el ?? null;
  }

  /** Resolves the next time all queued work is done and nothing waits to unmount. */
  onIdle(cb: () => void): () => void {
    this.idleListeners.add(cb);
    return () => this.idleListeners.delete(cb);
  }

  stats(): TextStats {
    let chars = 0;
    let offscreen = 0;
    for (const [id, m] of this.mounted) {
      chars += m.chars;
      if (!this.visible.has(id) && !this.pins.has(id)) offscreen++;
    }
    return { mounted: this.mounted.size, chars, pinned: [...this.pins.keys()], offscreenMounted: offscreen, work: { ...this.work } };
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    if (this.unmountTimer) clearTimeout(this.unmountTimer);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.root.remove();
  }

  /** Works out what should be mounted, and with how many characters, for the current camera. */
  private refresh(): void {
    const cam = this.camera;
    if (!cam) return;
    const started = performance.now();
    // The viewport in world units, plus half a screen of overscan on every side.
    const w = cam.screenWidth / cam.scale;
    const h = cam.screenHeight / cam.scale;
    const x0 = -cam.x / cam.scale - w / 2;
    const y0 = -cam.y / cam.scale - h / 2;
    const x1 = x0 + w * 2;
    const y1 = y0 + h * 2;

    const visible = new Set<string>();
    const budgetItems = [];
    for (const item of this.items.values()) {
      const pinned = this.pins.has(item.id);
      const inView = item.x < x1 && item.x + item.width > x0 && item.y < y1 && item.y + item.height > y0;
      if (!inView && !pinned) continue;
      visible.add(item.id);
      const area = item.width * cam.scale * Math.min(item.height, 2000) * cam.scale;
      budgetItems.push({ id: item.id, screenArea: area, fullChars: item.source.length, pinned });
    }
    this.visible = visible;
    this.wanted = allocate(budgetItems, this.options.total ?? TOTAL_CHARS, this.options.floor ?? FLOOR_CHARS);

    // Mount or re-render where the budget changed enough to matter; biggest on-screen first.
    const moving = performance.now() < this.movingUntil;
    const jobs: Array<{ id: string; area: number }> = [];
    for (const b of budgetItems) {
      const m = this.mounted.get(b.id);
      const want = this.wanted.get(b.id)!;
      const item = this.items.get(b.id)!;
      const resize = m && m.version === item.version && !moving && this.needsRerender(m, want, b.fullChars);
      if (!m || m.version !== item.version || resize) {
        jobs.push({ id: b.id, area: b.pinned ? Infinity : b.screenArea });
      }
    }
    jobs.sort((a, b) => b.area - a.area);
    this.queue = jobs.map((j) => j.id);
    this.schedule();

    if (this.unmountTimer) clearTimeout(this.unmountTimer);
    this.unmountTimer = setTimeout(() => this.unmountHidden(), UNMOUNT_IDLE_MS);
    this.work.refreshMs += performance.now() - started;
    this.work.refreshes++;
  }

  /** Re-render only for a real change: much more room (reveal) or much less (keep DOM bounded). */
  private needsRerender(m: Mounted, want: number, full: number): boolean {
    // A mounted selection must never be torn down under the user (FR-034).
    if (this.pins.get(m.el.dataset.nodeId!)?.has("selection")) return false;
    if (m.clipped && want >= Math.min(full, Math.max(m.chars * 1.5, m.chars + 40))) return true;
    if (m.chars > want * 2 + 40) return true;
    return false;
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const start = performance.now();
      const slice = this.filled ? FRAME_WORK_MS : FIRST_FILL_WORK_MS;
      while (this.queue.length > 0 && performance.now() - start < slice) {
        this.render(this.queue.shift()!);
        this.work.renders++;
      }
      this.work.renderMs += performance.now() - start;
      if (this.queue.length > 0) this.schedule();
      else this.maybeIdle();
    });
  }

  private render(id: string): void {
    const item = this.items.get(id);
    const want = this.wanted.get(id);
    if (!item || want === undefined) return;
    let m = this.mounted.get(id);
    if (!m) {
      const el = this.world.ownerDocument.createElement("div");
      el.dataset.testid = "element-text";
      el.dataset.nodeId = id;
      el.setAttribute("role", "article");
      this.world.appendChild(el);
      m = { el, chars: 0, clipped: false, version: -1 };
      this.mounted.set(id, m);
    }
    m.el.className = `element-text ${item.className}`;
    this.place(m.el, item);
    const { rich, partial } = richTextPrefix(id, item.source, item.markdown, want);
    const cut = clip(rich, want);
    const clipped = cut.clipped || partial;
    renderBlocks(m.el, cut.blocks, clipped, item.decorate ?? null);
    m.chars = cut.chars;
    m.clipped = clipped;
    m.version = item.version;
  }

  private place(el: HTMLElement, item: TextItem): void {
    el.style.left = `${item.x}px`;
    el.style.top = `${item.y}px`;
    el.style.width = `${item.width}px`;
    el.style.height = `${item.height}px`;
  }

  private unmountHidden(): void {
    this.unmountTimer = null;
    for (const [id, m] of this.mounted) {
      if (this.visible.has(id) || this.pins.has(id)) continue;
      m.el.remove();
      this.mounted.delete(id);
    }
    this.maybeIdle();
  }

  private maybeIdle(): void {
    if (this.queue.length > 0 || this.unmountTimer) return;
    this.filled = true;
    for (const cb of this.idleListeners) cb();
  }
}
