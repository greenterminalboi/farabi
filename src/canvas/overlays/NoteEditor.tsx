"use client";

// One short note per edge (FR-040): a small text box over the edge's note chip. Enter saves, an
// empty value clears the note, and Escape or clicking away cancels. Every save is a new version.
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useEngine, useFrame } from "../engine";
import { useCanvasStore } from "../store";

export function NoteEditor() {
  const engine = useEngine();
  useFrame(engine);
  const [editing, setEditing] = useState<{ edgeId: string; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const open = (e: Event) => {
      const { edgeId } = (e as CustomEvent<{ edgeId: string }>).detail;
      const edge = useCanvasStore.getState().elements.get(edgeId);
      setError(null);
      setEditing({ edgeId, value: edge?.note ?? "" });
    };
    window.addEventListener("farabi:edit-note", open);
    return () => window.removeEventListener("farabi:edit-note", open);
  }, []);

  if (!editing || !engine) return null;
  const rect = engine.screenRect(editing.edgeId);
  if (!rect) return null;
  const host = engine.renderer.canvas?.getBoundingClientRect();

  async function save(value: string) {
    if (!editing) return;
    try {
      const { edge } = await api.setNote(editing.edgeId, value.trim() ? value : null);
      useCanvasStore.getState().merge([edge]);
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the note");
    }
  }

  return (
    <form
      className="edge-label-editor note-editor"
      data-overlay
      data-testid="note-editor"
      style={{ left: (host?.left ?? 0) + rect.x + 8, top: (host?.top ?? 0) + rect.y - 26, transform: "none" }}
      onSubmit={(e) => {
        e.preventDefault();
        void save(editing.value);
      }}
    >
      <input
        autoFocus
        aria-label="Edge note"
        placeholder="A short note on this link…"
        maxLength={200}
        value={editing.value}
        onChange={(e) => setEditing({ ...editing, value: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(null);
        }}
        onBlur={() => setEditing(null)}
      />
      {error && (
        <span className="parked-error" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
