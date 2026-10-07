"use client";

// One canvas per project (FR-023; research R7, R13). The host owns the drawn layer, the text layer,
// the camera and input, loads the project's elements, lays them out, and renders the screen-space
// overlays. Layout and drawing happen outside React, once per animation frame at most.
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { followReply } from "@/lib/replyStream";
import type { Element } from "@/shared/schemas";
import { useSettingsStore } from "@/state/settingsStore";
import { Camera } from "./camera";
import { type CanvasEngine, EngineContext } from "./engine";
import { ancestors, buildGraph, type CanvasGraph, children, element, firstChild, mergeGraph } from "./graph";
import { installInput, type Walk } from "./input";
import { type ForestLayout, layoutForest, type LayoutCache } from "./layout/forestLayout";
import { heightOf } from "./layout/heights";
import { CanvasRenderer } from "./renderer/CanvasRenderer";
import { buildScene } from "./scene";
import { isVisible, useCanvasStore } from "./store";
import { TextLayer } from "./text/TextLayer";
import { Composer } from "./overlays/Composer";
import { CanvasMenu } from "./overlays/CanvasMenu";
import { EmptyState } from "./overlays/EmptyState";

declare global {
  interface Window {
    __farabiCanvasDrift?: () => number;
    __farabiTextStats?: () => import("./text/TextLayer").TextStats;
    __farabiCamera?: () => import("./camera").CameraState;
    __farabiFrameStats?: (ms: number) => Promise<{ p50: number; p95: number; max: number; frames: number }>;
  }
}

const REFETCH_MS = 10_000;
const STREAM_LAYOUT_MS = 100;
const CAMERA_IDLE_MS = 500;

type Props = { projectId: string; focus?: string | null };

export function CanvasHost({ projectId, focus }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<CanvasEngine | null>(null);
  const [loaded, setLoaded] = useState(false);
  const hasTrees = useCanvasStore((s) => s.trees.length > 0);

  useEffect(() => {
    void useCanvasStore.persist.rehydrate();
    void useSettingsStore.persist.rehydrate();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const root = rootRef.current;
    if (!host || !root) return;
    let destroyed = false;
    let cleanup = () => {};

    void (async () => {
      await document.fonts.load("15px OpenDyslexic").catch(() => []);
      const renderer = new CanvasRenderer();
      await renderer.mount(host);
      if (destroyed) {
        renderer.destroy();
        return;
      }
      const layer = new TextLayer(host);
      const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const camera = new Camera(renderer.cameraView(), { reducedMotion });

      // State kept outside React.
      const graph: CanvasGraph = buildGraph([]);
      const cache: LayoutCache = new Map();
      let layout: ForestLayout = { positions: new Map(), boxes: new Map(), relocations: [] };
      const streaming = new Map<string, string>();
      const streams = new Map<string, () => void>();
      const dragOverride = new Map<string, { x: number; y: number }>();
      const frameListeners = new Set<() => void>();
      let pendingTrees = new Set<string>();
      let fullRelayout = true;
      let followAfterLayout: string | null = null;
      let raf = 0;
      let showRejected = useSettingsStore.getState().showRejected;

      const visible = (el: Element) => isVisible(el, showRejected);
      const height = (el: Element) => {
        const streamed = el.status === "pending" ? streaming.get(el.id) : undefined;
        return heightOf(streamed !== undefined ? { ...el, partialText: streamed } : el);
      };
      const notify = () => {
        for (const cb of frameListeners) cb();
      };

      const rebuild = () => {
        raf = 0;
        const { elements, trees, focusId } = useCanvasStore.getState();
        const changed = fullRelayout ? new Set(trees.map((t) => t.id)) : pendingTrees;
        fullRelayout = false;
        pendingTrees = new Set();
        const before = camera.target ? layout.positions.get(camera.target) : undefined;

        const origins = new Map<string, Element>();
        for (const el of elements.values()) if (el.parentId === null) origins.set(el.treeId, el);
        const input = { graph, visible, height };
        layout = layoutForest(input, trees, origins, changed, cache);
        // Trees moved only to avoid overlap are saved, but never marked as placed by the user.
        for (const r of layout.relocations) void api.setTreeOrigin(r.treeId, r.x, r.y, false).catch(() => {});
        if (layout.relocations.length) {
          useCanvasStore.setState((s) => ({
            trees: s.trees.map((t) => {
              const r = layout.relocations.find((x) => x.treeId === t.id);
              return r ? { ...t, origin: { x: r.x, y: r.y } } : t;
            }),
          }));
        }

        const path = new Set<string>();
        if (focusId && element(graph, focusId)) {
          path.add(focusId);
          for (const a of ancestors(graph, focusId)) path.add(a.id);
        }
        const scene = buildScene({
          graph,
          elements: elements.values(),
          layout,
          visible,
          height,
          streaming,
          focusId,
          dragOverride,
        });
        renderer.setScene({ elements: scene.draw, trees: layout.boxes, focusId, path }, changed);
        layer.setItems(scene.items);

        let bounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
        for (const b of layout.boxes.values()) {
          bounds = bounds
            ? { minX: Math.min(bounds.minX, b.minX), minY: Math.min(bounds.minY, b.minY), maxX: Math.max(bounds.maxX, b.maxX), maxY: Math.max(bounds.maxY, b.maxY) }
            : { ...b };
        }
        camera.setBounds(bounds);

        // While following, the target stays put on screen through a relayout (R11).
        if (camera.target && before) {
          const after = layout.positions.get(camera.target);
          if (after) camera.relayoutCompensate(camera.target, after.x - before.x, after.y - before.y);
          const box = renderer.element(camera.target)?.box;
          if (box) camera.onTargetResized(camera.target, box);
        }
        if (followAfterLayout) {
          const box = renderer.element(followAfterLayout)?.box;
          if (box) {
            camera.follow(followAfterLayout, box);
            followAfterLayout = null;
          }
        }
        notify();
      };

      const schedule = (trees?: Iterable<string>) => {
        if (trees) for (const t of trees) pendingTrees.add(t);
        else fullRelayout = true;
        if (!raf) raf = requestAnimationFrame(rebuild);
      };

      // Streaming answers: text arrives over SSE and is laid out at most every 100 ms (FR-011).
      const streamTimers = new Map<string, number>();
      const syncStreams = () => {
        const { elements } = useCanvasStore.getState();
        for (const el of elements.values()) {
          if (el.status !== "pending" || streams.has(el.id)) continue;
          layer.pin(el.id, "stream");
          const close = followReply(
            el.id,
            (text) => {
              streaming.set(el.id, text);
              if (streamTimers.has(el.id)) return;
              streamTimers.set(
                el.id,
                window.setTimeout(() => {
                  streamTimers.delete(el.id);
                  schedule([el.treeId]);
                }, STREAM_LAYOUT_MS),
              );
            },
            (answer) => {
              streams.get(el.id)?.();
              streams.delete(el.id);
              streaming.delete(el.id);
              layer.unpin(el.id, "stream");
              useCanvasStore.getState().merge([answer]);
            },
          );
          streams.set(el.id, close);
        }
      };

      // The store drives everything: data changes relayout only the trees they touch.
      let lastRevision = -1;
      let lastFocus: string | null = null;
      const unsubscribe = useCanvasStore.subscribe((s) => {
        if (s.revision !== lastRevision) {
          lastRevision = s.revision;
          if (s.projectId !== projectId) return;
          const touched = mergeGraph(graph, s.elements.values());
          syncStreams();
          schedule(touched);
        }
        if (s.focusId !== lastFocus) {
          const trees = [lastFocus, s.focusId].map((id) => (id ? s.elements.get(id)?.treeId : undefined)).filter(Boolean) as string[];
          lastFocus = s.focusId;
          schedule(trees);
        }
      });
      const unsubscribeSettings = useSettingsStore.subscribe((s) => {
        if (s.showRejected === showRejected) return;
        showRejected = s.showRejected;
        cache.clear();
        schedule();
      });

      // The text layer follows the camera in the frame the canvas renders (FR-029).
      const offCamera = renderer.onCameraChange(() => {
        layer.setCamera(renderer.camera());
        notify();
      });

      // Saving the camera once it rests (FR-028).
      let cameraTimer = 0;
      const offSave = renderer.onCameraChange(() => {
        window.clearTimeout(cameraTimer);
        cameraTimer = window.setTimeout(() => {
          const c = renderer.cameraView();
          const center = c.center();
          void api.saveCamera(projectId, { x: center.x, y: center.y, scale: c.scale() }).catch(() => {});
        }, CAMERA_IDLE_MS);
      });

      const walk = (dir: Walk) => {
        const { focusId } = useCanvasStore.getState();
        const cur = focusId ? element(graph, focusId) : undefined;
        if (!cur) return;
        let next: Element | undefined;
        if (dir === "parent") next = cur.parentId ? element(graph, cur.parentId) : undefined;
        else if (dir === "child") next = firstChild(graph, cur.id, visible) ?? children(graph, cur.id).find(visible);
        else {
          const sibs = cur.parentId ? children(graph, cur.parentId).filter(visible) : [];
          const i = sibs.findIndex((s) => s.id === cur.id);
          next = sibs[dir === "prev" ? i - 1 : i + 1];
        }
        if (next) engineApi.walkTo(next.id);
      };

      // Dragging moves one element relative to its tree, or the whole tree (FR-037).
      let dragStart: { id: string; tree: boolean; origin: { x: number; y: number }; ids: string[]; at: Map<string, { x: number; y: number }> } | null = null;
      const onDrag = (id: string, phase: "start" | "move" | "end" | "cancel", delta: { x: number; y: number }, tree: boolean) => {
        const { elements, trees } = useCanvasStore.getState();
        const el = elements.get(id);
        if (!el) return;
        if (phase === "start") {
          const t = trees.find((x) => x.id === el.treeId);
          if (!t) return;
          const ids = tree ? [...elements.values()].filter((e) => e.treeId === el.treeId).map((e) => e.id) : [id];
          dragStart = { id, tree, origin: { ...t.origin }, ids, at: new Map(ids.map((i) => [i, layout.positions.get(i)!]).filter(([, p]) => p) as Array<[string, { x: number; y: number }]>) };
          return;
        }
        if (!dragStart) return;
        const d = dragStart;
        if (phase === "move") {
          for (const [i, p] of d.at) dragOverride.set(i, { x: p.x + delta.x, y: p.y + delta.y });
          schedule([el.treeId]);
          return;
        }
        dragStart = null;
        dragOverride.clear();
        if (phase === "cancel") {
          schedule([el.treeId]);
          return;
        }
        if (d.tree) {
          const origin = { x: d.origin.x + delta.x, y: d.origin.y + delta.y };
          useCanvasStore.setState((s) => ({ trees: s.trees.map((t) => (t.id === el.treeId ? { ...t, origin, userPlaced: true } : t)) }));
          cache.delete(el.treeId);
          schedule([el.treeId]);
          void api.setTreeOrigin(el.treeId, origin.x, origin.y, true).catch(() => {});
        } else {
          const p = d.at.get(id);
          const t = useCanvasStore.getState().trees.find((x) => x.id === el.treeId);
          if (!p || !t) return;
          const manual = { x: p.x + delta.x - t.origin.x, y: p.y + delta.y - t.origin.y };
          useCanvasStore.getState().merge([{ ...el, manual }]);
          void api.setPosition(id, manual.x, manual.y).catch(() => {});
        }
      };

      const engineApi: CanvasEngine = {
        renderer,
        layer,
        camera,
        walkTo: (id) => {
          useCanvasStore.getState().focus(id);
          const box = renderer.element(id)?.box;
          if (box && !raf) camera.follow(id, box);
          else followAfterLayout = id;
        },
        merge: (els) => useCanvasStore.getState().merge(els),
        onFrame: (cb) => {
          frameListeners.add(cb);
          return () => frameListeners.delete(cb);
        },
        screenRect: (id) => renderer.elementScreenRect(id),
        size: () => ({ width: host.clientWidth, height: host.clientHeight }),
        focusComposer: () => window.dispatchEvent(new Event("farabi:focus-composer")),
      };

      const offInput = installInput({
        host,
        layerRoot: layer.root,
        renderer,
        camera,
        handlers: {
          focus: (id) => useCanvasStore.getState().focus(id),
          drag: onDrag,
          isOrigin: (id) => useCanvasStore.getState().elements.get(id)?.parentId === null,
          walk,
          escape: () => {
            window.getSelection()?.removeAllRanges();
            useCanvasStore.getState().select(null);
          },
          slash: () => engineApi.focusComposer(),
          backgroundClick: () => useCanvasStore.getState().select(null),
        },
      });

      // Frame buttons (Retry, Stop, Confirm…) are text-layer chrome; one listener handles them all.
      const onAction = (e: MouseEvent) => {
        const button = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
        const item = button?.closest<HTMLElement>(".element-text");
        if (!button || !item) return;
        e.stopPropagation();
        void runAction(button.dataset.action!, item.dataset.nodeId!);
      };
      layer.root.addEventListener("click", onAction);

      const runAction = async (action: string, id: string) => {
        const store = useCanvasStore.getState();
        const el = store.elements.get(id);
        if (!el) return;
        try {
          if (action === "stop") store.merge([(await api.stop(id)).answer]);
          else if ((action === "retry" || action === "regenerate") && el.parentId) {
            const { answer } = await api.attempt(el.parentId, action);
            store.merge([answer]);
            engineApi.walkTo(answer.id);
          } else if (action === "confirm") store.merge([(await api.confirmOutput(id)).output]);
          else if (action === "reject") store.merge([(await api.rejectOutput(id)).output]);
          else if (action === "rerun" && el.parentId) store.merge([(await api.rerun(el.parentId)).output]);
          else window.dispatchEvent(new CustomEvent("farabi:element-action", { detail: { action, id } }));
        } catch (err) {
          window.dispatchEvent(new CustomEvent("farabi:element-error", { detail: { action, id, message: err instanceof Error ? err.message : String(err) } }));
        }
      };

      // Load, then keep in step: on window focus and every 10 s while visible (R13).
      let firstLoad = true;
      const load = async () => {
        const canvas = await api.getCanvas(projectId);
        if (destroyed) return;
        useCanvasStore.getState().load(projectId, canvas);
        if (firstLoad) {
          firstLoad = false;
          setLoaded(true);
          // Wait one layout so boxes exist, then place the camera.
          requestAnimationFrame(() => {
            if (destroyed) return;
            if (raf) {
              cancelAnimationFrame(raf);
              rebuild();
            }
            if (focus && renderer.element(focus)) engineApi.walkTo(focus);
            else if (canvas.camera) renderer.cameraView().moveTo(canvas.camera, 0);
            else {
              const latest = [...useCanvasStore.getState().elements.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
              const box = latest ? renderer.element(latest.id)?.box : undefined;
              if (box) renderer.cameraView().moveTo({ x: box.x + box.w / 2, y: box.y + box.h / 2, scale: 1 }, 0);
              else renderer.cameraView().moveTo({ x: 0, y: 0, scale: 1 }, 0);
            }
            layer.setCamera(renderer.camera());
          });
        }
      };
      void load().catch(() => setLoaded(true));
      const refetch = () => {
        if (document.visibilityState === "visible") void load().catch(() => {});
      };
      const timer = window.setInterval(refetch, REFETCH_MS);
      window.addEventListener("focus", refetch);

      if (process.env.NEXT_PUBLIC_FARABI_TEST_HOOKS === "1") installHooks(renderer, layer, camera);

      setEngine(engineApi);
      cleanup = () => {
        unsubscribe();
        unsubscribeSettings();
        offCamera();
        offSave();
        offInput();
        window.clearInterval(timer);
        window.clearTimeout(cameraTimer);
        window.removeEventListener("focus", refetch);
        layer.root.removeEventListener("click", onAction);
        for (const close of streams.values()) close();
        for (const t of streamTimers.values()) window.clearTimeout(t);
        cancelAnimationFrame(raf);
        layer.destroy();
        renderer.destroy();
      };
    })();

    return () => {
      destroyed = true;
      cleanup();
      setEngine(null);
    };
  }, [projectId, focus]);

  const overlays = useMemo(
    () =>
      engine && loaded ? (
        <>
          {!hasTrees && <EmptyState />}
          <CanvasMenu />
          <Composer />
        </>
      ) : null,
    [engine, loaded, hasTrees],
  );

  return (
    <EngineContext.Provider value={engine}>
      <div ref={rootRef} className="canvas-root">
        <div ref={hostRef} className="canvas-host" data-testid="canvas" />
        {overlays}
      </div>
    </EngineContext.Provider>
  );
}

function installHooks(renderer: CanvasRenderer, layer: TextLayer, camera: Camera): void {
  window.__farabiTextStats = () => layer.stats();
  window.__farabiCamera = () => camera.state();
  // Largest gap between a mounted item's box and its drawn frame, in screen px (FR-029).
  window.__farabiCanvasDrift = () => {
    const host = renderer.canvas?.getBoundingClientRect();
    if (!host) return Infinity;
    let worst = 0;
    const items = layer.root.querySelectorAll<HTMLElement>("[data-testid=element-text]");
    for (const item of [...items].slice(0, 50)) {
      const r = renderer.elementScreenRect(item.dataset.nodeId!);
      const el = renderer.element(item.dataset.nodeId!);
      if (!r || !el || el.display === "function_connector") continue;
      const b = item.getBoundingClientRect();
      worst = Math.max(worst, Math.abs(b.left - (host.left + r.x)), Math.abs(b.top - (host.top + r.y)));
    }
    return worst;
  };
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
}
