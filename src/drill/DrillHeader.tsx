"use client";

// The drill screen's header (contracts/drill-ui.md): the domain, the parent drill (R12), Back to
// canvas, the drill's settings (R10) and its attached conversations (FR-031). Saving a setting or
// attaching never calls the AI (FR-027).
import { useState } from "react";
import { ApiError, drillApi } from "@/lib/api";
import type { Drill } from "@/shared/schemas";
import { drillHref, goToCanvas } from "./canvasLinks";
import { useDrillStore } from "./store";

const SETTINGS = [
  { key: "round_size", label: "Problems per round", from: 1, to: 10 },
  { key: "open_level", label: "Open the next rung at level", from: 2, to: 9 },
  { key: "solid_level", label: "Mark a rung solid at level", from: 3, to: 10 },
] as const;

function Settings({ drill }: { drill: Drill }) {
  const set = useDrillStore((s) => s.set);
  const [error, setError] = useState<string | null>(null);
  async function save(key: string, value: string) {
    setError(null);
    try {
      await drillApi.saveSetting(drill.nodeId, key, value);
      set((await drillApi.get(drill.drillId)).drill);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the setting");
    }
  }
  return (
    <div className="drill-panel" data-testid="drill-settings">
      {SETTINGS.map((s) => (
        <label key={s.key} className="drill-row">
          {s.label}
          <select value={drill.settings[s.key]} onChange={(e) => void save(s.key, e.target.value)}>
            {Array.from({ length: s.to - s.from + 1 }, (_, i) => String(s.from + i)).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      ))}
      <p className="drill-muted">Changes apply from the next round.</p>
      {error && <p className="drill-error">{error}</p>}
    </div>
  );
}

function Attachments({ drill }: { drill: Drill }) {
  const run = useDrillStore((s) => s.run);
  return (
    <div className="drill-panel" data-testid="drill-attachments">
      <p className="drill-muted">The AI reads attached conversations when it writes lessons and problems.</p>
      {drill.attachments.length === 0 && <p className="drill-muted">Nothing attached.</p>}
      <ul className="drill-links">
        {drill.attachments.map((a) => (
          <li key={a.nodeId} className="drill-row">
            <span className="drill-excerpt">{a.excerpt}</span>
            <button type="button" className="btn btn-small" onClick={() => void run("detach", () => drillApi.attach(drill.drillId, a.nodeId, "detach"))}>
              Detach
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-small" onClick={() => void goToCanvas(drill.projectId, { attachTo: drill.drillId, returnTo: drillHref(drill.drillId) })}>
        Attach from canvas
      </button>
    </div>
  );
}

export function DrillHeader({ drill }: { drill: Drill }) {
  const [panel, setPanel] = useState<"settings" | "attachments" | null>(null);
  const toggle = (p: typeof panel) => setPanel(panel === p ? null : p);
  return (
    <header className="drill-header">
      <div className="drill-row">
        <button type="button" className="btn btn-small" onClick={() => void goToCanvas(drill.projectId, { focus: drill.nodeId })}>
          ← Back to canvas
        </button>
        <h1 className="drill-domain">{drill.domain}</h1>
        {drill.domainProvenance === "user_confirmed" && <span className="drill-muted">(suggested by the AI, confirmed by you)</span>}
        {drill.parentDrill && (
          <a className="drill-muted" href={`/drill/${drill.parentDrill.drillId}`}>
            from {drill.parentDrill.domain}
          </a>
        )}
        <span className="chrome-right" />
        <button type="button" className="btn btn-small" aria-pressed={panel === "attachments"} onClick={() => toggle("attachments")}>
          Attached ({drill.attachments.length})
        </button>
        <button type="button" className="btn btn-small" aria-pressed={panel === "settings"} onClick={() => toggle("settings")}>
          Settings
        </button>
      </div>
      {panel === "settings" && <Settings drill={drill} />}
      {panel === "attachments" && <Attachments drill={drill} />}
    </header>
  );
}
