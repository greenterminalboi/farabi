"use client";

import { useSettingsStore } from "@/state/settingsStore";

/** Shows or hides the minimap; the choice is kept per browser (FR-027). */
export function MinimapToggle() {
  const hidden = useSettingsStore((s) => s.minimapHidden);
  const setHidden = useSettingsStore((s) => s.setMinimapHidden);
  return (
    <button
      type="button"
      className={`btn btn-small minimap-toggle${hidden ? " hidden-map" : ""}`}
      data-testid="minimap-toggle"
      data-overlay
      aria-pressed={!hidden}
      title={hidden ? "Show the minimap" : "Hide the minimap"}
      onClick={() => setHidden(!hidden)}
    >
      {hidden ? "Map" : "×"}
    </button>
  );
}
