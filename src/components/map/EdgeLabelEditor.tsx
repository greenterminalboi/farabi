"use client";

import { useState } from "react";

type Props = {
  x: number;
  y: number;
  initial: string;
  onSave: (text: string | null) => void;
  onCancel: () => void;
};

/**
 * A small text box over the map at the clicked edge (FR-023, FR-025). Enter saves; an empty value
 * clears the label; Escape or clicking away cancels.
 */
export function EdgeLabelEditor({ x, y, initial, onSave, onCancel }: Props) {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="edge-label-editor"
      style={{ left: x, top: y }}
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value.trim() ? value : null);
      }}
    >
      <input
        autoFocus
        aria-label="Edge label"
        placeholder="Label this link…"
        maxLength={200}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        onBlur={onCancel}
      />
    </form>
  );
}
