// The camera follows the user, or nothing (research R11, FR-025, SC-008). Two modes:
// - follow(target): entered by a send or a walk; glides to the target and, while the target is a
//   streaming answer, keeps its bottom in view as it grows
// - free: entered by any manual pan, zoom or pinch; nothing moves the camera until the next send
//   or walk
// No other event moves the camera: data arriving, a function output, another tree growing or a
// relayout all leave it where it is.
import type { Box } from "./geometry";

export const MIN_SCALE = 0.02;
export const MAX_SCALE = 4;
const GLIDE_MS = 350;
const MARGIN = 48;

/** What the camera drives: a pixi-viewport in the app, a fake in tests. */
export interface CameraView {
  /** World scale (1 = one world unit per CSS pixel). */
  scale(): number;
  /** World point at the screen centre. */
  center(): { x: number; y: number };
  screen(): { width: number; height: number };
  /** Moves to `to`, gliding over `ms` (0 = at once). */
  moveTo(to: { x: number; y: number; scale: number }, ms: number): void;
  setMinScale(min: number): void;
}

export type CameraState = { mode: "follow" | "free"; target: string | null; x: number; y: number; scale: number; moves: number };

export class Camera {
  mode: "follow" | "free" = "free";
  target: string | null = null;
  /** Automatic moves since load (SC-008 counts these). */
  moves = 0;
  private reducedMotion: () => boolean;

  constructor(
    private readonly view: CameraView,
    options: { reducedMotion?: () => boolean } = {},
  ) {
    this.reducedMotion = options.reducedMotion ?? (() => false);
  }

  /** A send or a walk: follow `id` and glide until its box is in view (FR-025, within 1 s). */
  follow(id: string, box: Box): void {
    this.mode = "follow";
    this.target = id;
    this.glide(this.fit(box));
  }

  /** Any manual pan, zoom or pinch. */
  onManual(): void {
    this.mode = "free";
  }

  /** The followed element changed size (a streaming answer): keep its bottom in view. */
  onTargetResized(id: string, box: Box): void {
    if (this.mode !== "follow" || this.target !== id) return;
    const { height } = this.view.screen();
    const scale = this.view.scale();
    const c = this.view.center();
    const bottom = c.y + (height / 2 - MARGIN) / scale;
    if (box.y + box.h <= bottom) return;
    // Scroll down just enough, never past the element's top.
    const dy = Math.min(box.y + box.h - bottom, box.y - (c.y - (height / 2 - MARGIN) / scale));
    if (dy <= 0) return;
    this.moves++;
    this.view.moveTo({ x: c.x, y: c.y + dy, scale }, 0);
  }

  /**
   * A relayout moved the followed element by (dx, dy) in world units: move with it so it stays put
   * on screen. In free mode a relayout never moves the camera.
   */
  relayoutCompensate(id: string, dx: number, dy: number): void {
    if (this.mode !== "follow" || this.target !== id || (dx === 0 && dy === 0)) return;
    const c = this.view.center();
    this.moves++;
    this.view.moveTo({ x: c.x + dx, y: c.y + dy, scale: this.view.scale() }, 0);
  }

  /** Zoom limits: 0.02..4, and the project never shrinks below a quarter of the screen. */
  setBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number } | null): void {
    const { width, height } = this.view.screen();
    let min = MIN_SCALE;
    if (bounds) {
      const w = Math.max(1, bounds.maxX - bounds.minX);
      const h = Math.max(1, bounds.maxY - bounds.minY);
      min = Math.max(MIN_SCALE, Math.min(width / 4 / w, height / 4 / h, 1));
    }
    this.view.setMinScale(Math.min(min, MAX_SCALE));
  }

  state(): CameraState {
    const c = this.view.center();
    return { mode: this.mode, target: this.target, x: c.x, y: c.y, scale: this.view.scale(), moves: this.moves };
  }

  /** Where to look at `box`: readable size if it fits, its top first if it doesn't. */
  private fit(box: Box): { x: number; y: number; scale: number } {
    const { width, height } = this.view.screen();
    const fitWidth = (width - MARGIN * 2) / Math.max(1, box.w);
    const scale = clamp(Math.min(1, fitWidth), MIN_SCALE, MAX_SCALE);
    const viewH = (height - MARGIN * 2) / scale;
    const x = box.x + box.w / 2;
    const y = box.h <= viewH ? box.y + box.h / 2 : box.y + viewH / 2;
    return { x, y, scale };
  }

  private glide(to: { x: number; y: number; scale: number }): void {
    this.moves++;
    this.view.moveTo(to, this.reducedMotion() ? 0 : GLIDE_MS);
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
