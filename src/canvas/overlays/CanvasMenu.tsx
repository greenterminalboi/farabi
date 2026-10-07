"use client";

import { useState } from "react";
import { NewDrillOverlay } from "@/drill/CanvasOverlays";
import { useSettingsStore } from "@/state/settingsStore";
import { useCanvasStore } from "../store";

/**
 * The canvas menu: start a new tree or a drill (Feature 12), and per-browser display settings
 * (FR-010, FR-050, FR-056).
 */
export function CanvasMenu() {
  const composingNewTree = useCanvasStore((s) => s.composingNewTree);
  const setComposingNewTree = useCanvasStore((s) => s.setComposingNewTree);
  const showRejected = useSettingsStore((s) => s.showRejected);
  const showSuggestions = useSettingsStore((s) => s.showSuggestions);
  const setShowSuggestions = useSettingsStore((s) => s.setShowSuggestions);
  const setShowRejected = useSettingsStore((s) => s.setShowRejected);
  const [newDrill, setNewDrill] = useState(false);
  return (
    <div className="canvas-menu" data-overlay>
      <button
        type="button"
        className="btn btn-small"
        aria-pressed={composingNewTree}
        onClick={() => {
          setComposingNewTree(!composingNewTree);
          window.dispatchEvent(new Event("farabi:focus-composer"));
        }}
      >
        New tree
      </button>
      <button type="button" className="btn btn-small" data-testid="new-drill" aria-pressed={newDrill} onClick={() => setNewDrill(!newDrill)}>
        New drill
      </button>
      {newDrill && <NewDrillOverlay onClose={() => setNewDrill(false)} />}
      <label className="canvas-menu-toggle" title="Underline bold text in answers as places to branch">
        <input type="checkbox" checked={showSuggestions} onChange={(e) => setShowSuggestions(e.target.checked)} />
        Suggestions
      </label>
      <label className="canvas-menu-toggle">
        <input type="checkbox" checked={showRejected} onChange={(e) => setShowRejected(e.target.checked)} />
        Show rejected
      </label>
    </div>
  );
}
