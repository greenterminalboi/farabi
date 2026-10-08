"use client";
// The player (FR-006 to FR-010, US1, US2): play, pause, step, scrub, speed, keyboard, captions
// announced politely, a full text alternative, and still export of the exact frame on screen.
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Scene } from "../schema";
import { captionAt, describeState, textAlternative } from "../state";
import { clampT, statesOf, tick } from "../timeline";
import { exportPng, exportSvg } from "./exportImage";
import { VizFrame } from "./VizFrame";
import styles from "./viz.module.css";

const REDUCED = "(prefers-reduced-motion: reduce)";

function subscribeReduced(cb: () => void) {
  const mq = window.matchMedia?.(REDUCED);
  mq?.addEventListener("change", cb);
  return () => mq?.removeEventListener("change", cb);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia?.(REDUCED).matches ?? false,
    () => false,
  );
}

const STEP_TWEEN_MS = 320;

export type VizPlayerProps = {
  scene: Scene;
  autoPlay?: boolean;
  initialFrame?: number;
  onFrameChange?: (frame: number) => void;
  /** Hide the export buttons (e.g. where a host saves stills itself). */
  hideExport?: boolean;
  className?: string;
};

export function VizPlayer(props: VizPlayerProps) {
  // A new scene starts a fresh player (state resets with the key).
  return <PlayerInner key={sceneKey(props.scene)} {...props} />;
}

const keys = new WeakMap<Scene, string>();
let nextKey = 0;
function sceneKey(scene: Scene): string {
  let k = keys.get(scene);
  if (!k) keys.set(scene, (k = `s${nextKey++}`));
  return k;
}

function PlayerInner({ scene, autoPlay = false, initialFrame = 0, onFrameChange, hideExport, className }: VizPlayerProps) {
  const n = scene.steps.length;
  const reduced = usePrefersReducedMotion();
  const [t, setT] = useState(() => clampT(scene, initialFrame));
  const [playing, setPlaying] = useState(autoPlay && n > 0);
  const [speed, setSpeed] = useState(1);
  const [exportError, setExportError] = useState<string | null>(null);
  const head = useRef({ t, hold: 0 });
  const raf = useRef<number | null>(null);
  const last = useRef<number | null>(null);
  const tween = useRef<{ from: number; to: number; start: number } | null>(null);

  const frame = Math.min(n, Math.max(0, Math.floor(t + 1e-6)));
  const states = statesOf(scene);
  const caption = captionAt(scene, frame);

  useEffect(() => {
    onFrameChange?.(frame);
  }, [frame, onFrameChange]);

  const stopLoop = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    last.current = null;
    tween.current = null;
  }, []);

  useEffect(() => stopLoop, [stopLoop]);

  const setPosition = useCallback(
    (value: number) => {
      const v = clampT(scene, value);
      head.current = { t: v, hold: 0 };
      setT(v);
    },
    [scene],
  );

  // The animation frame callback reads the latest settings through refs, so a running loop picks
  // up speed or reduced-motion changes without restarting.
  const settings = useRef({ reduced, speed });
  useEffect(() => {
    settings.current = { reduced, speed };
  }, [reduced, speed]);
  const frameFn = useRef<(now: number) => void>(() => {});
  const startLoop = useCallback(() => {
    raf.current = requestAnimationFrame((now) => frameFn.current(now));
  }, []);
  useEffect(() => {
    frameFn.current = (now: number) => {
      const dt = last.current === null ? 0 : Math.min(250, now - last.current);
      last.current = now;
      if (tween.current) {
        const { from, to, start } = tween.current;
        // rAF timestamps can be slightly earlier than the performance.now() the tween started at.
        const p = Math.max(0, Math.min(1, (now - start) / STEP_TWEEN_MS));
        const v = from + (to - from) * p;
        head.current = { t: v, hold: 0 };
        setT(v);
        if (p >= 1) {
          stopLoop();
          return;
        }
      } else {
        const next = tick(scene, head.current, dt, { reducedMotion: settings.current.reduced, speed: settings.current.speed });
        head.current = { t: next.t, hold: next.hold };
        setT(next.t);
        if (next.done) {
          setPlaying(false);
          stopLoop();
          return;
        }
      }
      raf.current = requestAnimationFrame((ts) => frameFn.current(ts));
    };
  }, [scene, stopLoop]);

  const play = useCallback(() => {
    if (n === 0) return;
    stopLoop();
    if (head.current.t >= n) setPosition(0);
    setPlaying(true);
    startLoop();
  }, [n, setPosition, startLoop, stopLoop]);

  const pause = useCallback(() => {
    stopLoop();
    setPlaying(false);
  }, [stopLoop]);

  const goTo = useCallback(
    (target: number) => {
      pause();
      const to = clampT(scene, target);
      if (settings.current.reduced || to === head.current.t) return setPosition(to);
      tween.current = { from: head.current.t, to, start: performance.now() };
      startLoop();
    },
    [pause, scene, setPosition, startLoop],
  );

  // While a step tween runs, Next/Previous count from where it is heading, so quick presses add up.
  const current = () => tween.current?.to ?? head.current.t;
  const next = () => goTo(Math.floor(current() + 1e-6) + 1);
  const prev = () => {
    const c = current();
    goTo(Math.abs(c - Math.round(c)) < 1e-6 ? Math.round(c) - 1 : Math.floor(c));
  };

  useEffect(() => {
    // autoPlay: the loop starts once on mount (playing was initialised from the prop).
    if (playing) startLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (el.tagName === "SELECT" || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "range")) return;
    if (el.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
    if (el.tagName === "SUMMARY") return;
    switch (e.key) {
      case " ":
      case "k":
        if (playing) pause();
        else play();
        break;
      case "ArrowRight":
        next();
        break;
      case "ArrowLeft":
        prev();
        break;
      case "Home":
        goTo(0);
        break;
      case "End":
        goTo(n);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const runExport = async (kind: "svg" | "png") => {
    setExportError(null);
    try {
      if (kind === "svg") exportSvg(scene, head.current.t);
      else await exportPng(scene, head.current.t);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    }
  };

  const summary = useMemo(() => describeState(scene, states[frame], frame), [scene, states, frame]);
  const alternative = useMemo(() => textAlternative(scene), [scene]);

  return (
    <div
      className={[styles.player, className].filter(Boolean).join(" ")}
      role="group"
      aria-label={`Visualization player: ${scene.title}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid="viz-player"
      data-frame={frame}
      data-playing={playing ? "true" : "false"}
    >
      <div className={styles.header}>
        <h3 className={styles.title}>{scene.title}</h3>
        {scene.origin === "ai-suggested" && (
          <span className={styles.aiBadge} title="Proposed by the AI from your text. Not reviewed.">
            AI-suggested
          </span>
        )}
      </div>
      <div className={styles.stage}>
        <VizFrame scene={scene} t={t} />
      </div>
      <p className={styles.caption} aria-live="polite" data-testid="viz-caption">
        {caption}
      </p>
      <div className={styles.controls}>
        <button type="button" className="btn btn-small" onClick={() => goTo(0)} disabled={n === 0 || t === 0} aria-label="Go to start">
          ⏮
        </button>
        <button type="button" className="btn btn-small" onClick={prev} disabled={n === 0 || t === 0} aria-label="Previous step">
          ◀
        </button>
        <button
          type="button"
          className="btn btn-small btn-primary"
          onClick={playing ? pause : play}
          disabled={n === 0}
          aria-label={playing ? "Pause" : "Play"}
          data-testid="viz-play"
        >
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <button type="button" className="btn btn-small" onClick={next} disabled={n === 0 || t >= n} aria-label="Next step">
          ▶
        </button>
        <button type="button" className="btn btn-small" onClick={() => goTo(n)} disabled={n === 0 || t >= n} aria-label="Go to end">
          ⏭
        </button>
        <input
          className={styles.scrubber}
          type="range"
          min={0}
          max={Math.max(n, 0.0001)}
          step={0.01}
          value={t}
          disabled={n === 0}
          aria-label="Position"
          aria-valuetext={`Step ${frame} of ${n}: ${caption}`}
          onChange={(e) => {
            pause();
            setPosition(Number(e.target.value));
          }}
        />
        <span className={styles.counter} data-testid="viz-counter">
          Step {frame} of {n}
        </span>
        <label className={styles.speed}>
          <span className={styles.visuallyHidden}>Speed</span>
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Speed">
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
          </select>
        </label>
        {!hideExport && (
          <>
            <button type="button" className="btn btn-small" onClick={() => runExport("svg")}>
              Export SVG
            </button>
            <button type="button" className="btn btn-small" onClick={() => runExport("png")}>
              Export PNG
            </button>
          </>
        )}
      </div>
      {exportError && (
        <p className={styles.error} role="alert">
          Export failed: {exportError}
        </p>
      )}
      <details className={styles.alt}>
        <summary>Text alternative</summary>
        <pre className={styles.altText} data-testid="viz-alt">
          {alternative}
        </pre>
        <p className={styles.altHeading}>Now showing</p>
        <pre className={styles.altText} data-testid="viz-summary">
          {summary}
        </pre>
      </details>
      <p className={styles.keys}>Keys: Space play/pause · ← → step · Home/End</p>
    </div>
  );
}
