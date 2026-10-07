"use client";

import { useSettingsStore } from "@/state/settingsStore";
import { useCanvasStore } from "../store";

/** The canvas menu: start a new tree, and per-browser display settings (FR-010, FR-050, FR-056). */
export function CanvasMenu() {
  const composingNewTree = useCanvasStore((s) => s.composingNewTree);
  const setComposingNewTree = useCanvasStore((s) => s.setComposingNewTree);
  const showRejected = useSettingsStore((s) => s.showRejected);
  const showSuggestions = useSettingsStore((s) => s.showSuggestions);
  const setShowSuggestions = useSettingsStore((s) => s.setShowSuggestions);
  const setShowRejected = useSettingsStore((s) => s.setShowRejected);
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
