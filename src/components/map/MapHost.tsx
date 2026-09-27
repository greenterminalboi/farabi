"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { diffForest } from "@/map/forestGraph";
import type { MapRenderer } from "@/map/MapRenderer";
import type { ForestResponse } from "@/shared/schemas";
import { useViewStore } from "@/state/viewStore";

const POLL_MS = 3000;
const PRELOAD_TIMEOUT_MS = 2000;

/**
 * Rendered once in the root layout and only hidden when not on /map, so the scene stays alive
 * and switching views is instant (research R7). The renderer is created during idle time after
 * the app loads, so the first visit to the map doesn't pay WebGL start-up (SC-006).
 */
export function MapHost() {
  const pathname = usePathname();
  const router = useRouter();
  const visible = pathname === "/map";
  const elRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const forestRef = useRef<ForestResponse | null>(null);
  const [ready, setReady] = useState(false);
  const lastNodeId = useViewStore((s) => s.lastNodeId);

  const refreshRef = useRef(async () => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const next = await api.getForest();
    const prev = forestRef.current;
    const diff = diffForest(prev, next);
    forestRef.current = next;
    const newTrees = next.trees.filter((t) => !prev?.trees.some((p) => p.id === t.id));
    if (!prev || diff.changedTreeIds.size > 0 || newTrees.length > 0) {
      const changed = prev ? new Set(diff.changedTreeIds) : new Set(next.trees.map((t) => t.id));
      for (const t of newTrees) changed.add(t.id);
      for (const r of renderer.setForest(next, changed)) {
        // Persist the new origin of a tree that outgrew its region (FR-023).
        void api.setTreeOrigin(r.treeId, r.x, r.y).then(({ tree }) => {
          const current = forestRef.current;
          if (current) {
            forestRef.current = { ...current, trees: current.trees.map((t) => (t.id === tree.id ? tree : t)) };
          }
        });
      }
    } else if (diff.changedSummaries.length > 0) {
      // Labels update in place without another layout pass.
      renderer.updateSummaries(diff.changedSummaries);
    }
  });

  // Create the renderer once: immediately if the map is open, otherwise when the browser is idle.
  const wantRenderer = useRef(false);
  useEffect(() => {
    const start = () => {
      if (wantRenderer.current || !elRef.current) return;
      wantRenderer.current = true;
      const el = elRef.current;
      // PixiJS is loaded on demand so chat pages don't ship or hydrate it.
      void import("@/map/MapRenderer")
        .then(async ({ MapRenderer }) => {
          const renderer = new MapRenderer();
          rendererRef.current = renderer;
          renderer.onNodeClick((id) => router.push(`/n/${id}`));
          await renderer.mount(el);
          await refreshRef.current();
        })
        .then(() => setReady(true));
    };
    if (visible) {
      start();
      return;
    }
    const idle = window.requestIdleCallback?.(start, { timeout: PRELOAD_TIMEOUT_MS });
    const timer = idle === undefined ? window.setTimeout(start, PRELOAD_TIMEOUT_MS) : undefined;
    return () => {
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [visible, router]);

  useEffect(() => () => rendererRef.current?.destroy(), []);

  // While visible: refresh on show, highlight the last conversation, and keep labels live.
  useEffect(() => {
    if (!visible || !ready) return;
    let cancelled = false;
    // Centre on the last conversation right away (the forest is preloaded) so the view doesn't
    // jump after the user has started interacting; only centre after loading if nothing was shown.
    // Bring out-of-date labels up to date; new ones arrive through the regular refresh below.
    void api.refreshStaleSummaries().catch(() => undefined);
    const hadForest = forestRef.current !== null;
    if (hadForest) rendererRef.current?.focusNode(lastNodeId);
    void refreshRef.current().then(() => {
      if (!cancelled && !hadForest) rendererRef.current?.focusNode(lastNodeId);
    });
    const id = setInterval(() => void refreshRef.current(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [visible, ready, lastNodeId]);

  return <div ref={elRef} className="map-host" hidden={!visible} data-testid="map" />;
}
