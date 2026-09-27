"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { diffForest } from "@/map/forestGraph";
import type { MapRenderer } from "@/map/MapRenderer";
import type { ForestResponse } from "@/shared/schemas";
import { useViewStore } from "@/state/viewStore";
import { EdgeLabelEditor } from "./EdgeLabelEditor";

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
  const [editing, setEditing] = useState<{ childId: string; x: number; y: number; initial: string } | null>(null);
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
    } else {
      // Labels update in place without another layout pass.
      if (diff.changedSummaries.length > 0) {
        // A longer label can make a box taller and move its tree; save such moves as usual.
        for (const r of renderer.updateSummaries(diff.changedSummaries)) void api.setTreeOrigin(r.treeId, r.x, r.y);
      }
      if (diff.labelsChanged) renderer.updateEdgeLabels(next);
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
          // Double-click zooms down into the node, then opens its conversation.
          renderer.onNodeOpen((id) => void renderer.zoomInto(id).then(() => router.push(`/n/${id}`)));
          // Save drags once, on release (FR-021); keep our copy in step so polling doesn't undo them.
          renderer.onNodeMoved((nodeId, x, y) => {
            const current = forestRef.current;
            if (current) {
              forestRef.current = {
                ...current,
                nodes: current.nodes.map((n) => (n.id === nodeId ? { ...n, manual: { x, y } } : n)),
              };
            }
            void api.setNodePosition(nodeId, x, y);
          });
          renderer.onEdgeClick((childId, screen) => {
            const current = forestRef.current?.nodes.find((n) => n.id === childId);
            setEditing({ childId, x: screen.x, y: screen.y, initial: current?.edgeLabel ?? "" });
          });
          renderer.onTreeMoved((treeId, x, y) => {
            const current = forestRef.current;
            if (current) {
              forestRef.current = {
                ...current,
                trees: current.trees.map((t) => (t.id === treeId ? { ...t, origin: { x, y }, userPlaced: true } : t)),
              };
            }
            void api.setTreeOrigin(treeId, x, y, true);
          });
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
    // Coming back from a conversation: zoom out with that node in focus.
    if (hadForest) rendererRef.current?.zoomOutTo(lastNodeId);
    void refreshRef.current().then(() => {
      if (!cancelled && !hadForest) rendererRef.current?.zoomOutTo(lastNodeId);
    });
    const id = setInterval(() => void refreshRef.current(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [visible, ready, lastNodeId]);

  function saveLabel(text: string | null) {
    if (!editing) return;
    const { childId } = editing;
    setEditing(null);
    rendererRef.current?.setEdgeLabel(childId, text?.trim() || null);
    const current = forestRef.current;
    if (current) {
      forestRef.current = {
        ...current,
        nodes: current.nodes.map((n) => (n.id === childId ? { ...n, edgeLabel: text?.trim().replace(/\s+/g, " ") || null } : n)),
      };
    }
    void api.setEdgeLabel(childId, text);
  }

  return (
    <>
      <div ref={elRef} className="map-host" hidden={!visible} data-testid="map" />
      {visible && editing && (
        <EdgeLabelEditor
          x={editing.x}
          y={editing.y}
          initial={editing.initial}
          onSave={saveLabel}
          onCancel={() => setEditing(null)}
        />
      )}
    </>
  );
}
