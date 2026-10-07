"use client";

// Clicks on decorated text (FR-018, FR-035, FR-056): a branch marker walks to its edge (a menu when
// several overlap), a suggested span becomes the selection exactly as if dragged over, and a
// collected term keeps its own hover card.
import { useEffect, useState } from "react";
import { useEngine } from "../engine";
import { rangeForOffsets } from "../text/selection";
import { useCanvasStore } from "../store";

type Menu = { x: number; y: number; edges: Array<{ id: string; label: string }> };

export function TextInteractions() {
  const engine = useEngine();
  const [menu, setMenu] = useState<Menu | null>(null);

  useEffect(() => {
    if (!engine) return;
    const root = engine.layer.root;
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("[data-action]")) return;
      const sel = document.getSelection();
      if (sel && !sel.isCollapsed) return; // the user is selecting, not clicking
      const marked = el.closest<HTMLElement>("[data-markers]");
      if (marked) {
        const ids = marked.dataset.markers!.split(" ");
        const { elements } = useCanvasStore.getState();
        if (ids.length === 1) {
          engine.walkTo(ids[0]);
          return;
        }
        setMenu({
          x: e.clientX,
          y: e.clientY,
          edges: ids.map((id) => {
            const edge = elements.get(id);
            return { id, label: edge?.text ? `“${edge.text.slice(0, 60)}”` : `Branch on “${edge?.anchor?.text.slice(0, 40) ?? "…"}”` };
          }),
        });
        return;
      }
      // A collected term keeps its own card; it never selects a suggestion.
      if (el.closest(".term-mark")) return;
      const suggestion = el.closest<HTMLElement>("[data-suggest]");
      const item = suggestion?.closest<HTMLElement>("[data-node-id]");
      // A double click is the browser selecting a word; only a single click selects the suggestion.
      if (!suggestion || !item || !sel || e.detail > 1) return;
      const [start, end] = suggestion.dataset.suggest!.split("-").map(Number);
      const range = rangeForOffsets(item, start, end);
      if (!range) return;
      sel.removeAllRanges();
      sel.addRange(range);
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [engine]);

  if (!menu || !engine) return null;
  return (
    <div className="marker-menu" data-overlay data-testid="marker-menu" style={{ left: menu.x, top: menu.y }} onMouseLeave={() => setMenu(null)}>
      {menu.edges.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => {
            setMenu(null);
            engine.walkTo(m.id);
          }}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
