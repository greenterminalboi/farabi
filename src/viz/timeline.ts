// Time (research R4): position t ∈ [0, N] in steps; frame i is whole, t between i and i+1 blends
// them. Playback spends 55% of a step's duration moving and the rest dwelling; with reduced motion
// it jumps and dwells for the whole duration.
import type { DrawItem } from "./draw";
import { blend, easeInOut } from "./interpolate";
import { layoutFrame } from "./layout";
import { DEFAULT_DURATION_MS, type Scene } from "./schema";
import { computeStates, type FrameState } from "./state";

export const MOVE_SHARE = 0.55;

type Cache = { states: FrameState[]; frames: (DrawItem[] | undefined)[] };
const caches = new WeakMap<Scene, Cache>();

function cacheFor(scene: Scene): Cache {
  let c = caches.get(scene);
  if (!c) {
    c = { states: computeStates(scene), frames: [] };
    caches.set(scene, c);
  }
  return c;
}

export function statesOf(scene: Scene): FrameState[] {
  return cacheFor(scene).states;
}

/** Draw items of whole frame i (cached per scene object). */
export function drawFrame(scene: Scene, i: number): DrawItem[] {
  const c = cacheFor(scene);
  const k = Math.max(0, Math.min(scene.steps.length, i));
  return (c.frames[k] ??= layoutFrame(scene, c.states[k]));
}

export const clampT = (scene: Scene, t: number) => Math.max(0, Math.min(scene.steps.length, Number.isFinite(t) ? t : 0));

/** Draw items at position t; fractional t blends neighbouring frames with easing. */
export function drawAt(scene: Scene, t: number): DrawItem[] {
  const ct = clampT(scene, t);
  const i = Math.floor(ct);
  const p = ct - i;
  if (p < 1e-6) return drawFrame(scene, i);
  return blend(drawFrame(scene, i), drawFrame(scene, i + 1), easeInOut(p));
}

export const stepDuration = (scene: Scene, frame: number) => scene.steps[frame - 1]?.durationMs ?? DEFAULT_DURATION_MS;

export type Playhead = { t: number; hold: number };
export type TickOptions = { reducedMotion: boolean; speed: number };

/** Advances playback by dt ms. Returns the new playhead and whether the end was reached. */
export function tick(scene: Scene, head: Playhead, dt: number, o: TickOptions): Playhead & { done: boolean } {
  const n = scene.steps.length;
  let { t, hold } = head;
  let left = dt;
  // A loop so a long frame (or a 0 ms step) still advances correctly.
  const EPS = 1e-6;
  for (let guard = 0; guard < 1000 && left > EPS; guard++) {
    if (hold > EPS) {
      const used = Math.min(hold, left);
      hold -= used;
      left -= used;
      continue;
    }
    hold = 0;
    if (t >= n) return { t: n, hold: 0, done: true };
    const i = Math.floor(t);
    const d = stepDuration(scene, i + 1) / Math.max(0.1, o.speed);
    const move = o.reducedMotion ? 0 : d * MOVE_SHARE;
    if (move <= 0) {
      t = i + 1;
      hold = d;
      if (t >= n) break;
      continue;
    }
    const need = (i + 1 - t) * move;
    if (left < need) {
      t += left / move;
      left = 0;
    } else {
      left -= need;
      t = i + 1;
      hold = d - move;
      if (t >= n) break;
    }
  }
  return t >= n ? { t: n, hold: 0, done: true } : { t, hold, done: false };
}
