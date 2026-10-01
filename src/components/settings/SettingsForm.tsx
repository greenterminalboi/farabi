"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { bandOf, MAX_PRESSURE, MIN_PRESSURE, PRESSURE_BANDS } from "@/shared/pressure";
import type { SaveSettingsBody, SettingsResponse } from "@/shared/schemas";
import { KindSettingsSections } from "./KindSettingsSections";

type Status = { kind: "saved" } | { kind: "error" } | null;

/**
 * Global reply settings (Feature 6, contracts/ui.md): information pressure and reply model. A
 * change shows as saved only once the server has recorded it; on failure the stored value returns.
 */
export function SettingsForm() {
  const [stored, setStored] = useState<SettingsResponse | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Controls stay usable while saving (disabling would drop keyboard focus); only the newest
  // request's answer is applied.
  const latestSave = useRef(0);

  useEffect(() => {
    api.getSettings().then(
      (s) => {
        setStored(s);
        setLevel(s.informationPressure);
      },
      () => setLoadError(true),
    );
    return () => clearTimeout(savedTimer.current);
  }, []);

  async function save(patch: SaveSettingsBody) {
    if (!stored) return;
    const id = ++latestSave.current;
    setStatus(null);
    clearTimeout(savedTimer.current);
    try {
      const next = await api.saveSettings(patch);
      if (id !== latestSave.current) return;
      setStored(next);
      setLevel(next.informationPressure);
      setStatus({ kind: "saved" });
      savedTimer.current = setTimeout(() => setStatus(null), 2000);
    } catch {
      if (id !== latestSave.current) return;
      // Show what is still in effect (spec edge case).
      const current = await api.getSettings().catch(() => stored);
      setStored(current);
      setLevel(current.informationPressure);
      setStatus({ kind: "error" });
    }
  }

  if (!stored || level === null) {
    return <div className="empty-state">{loadError ? "Couldn't load settings" : "Loading…"}</div>;
  }
  const band = bandOf(level);

  return (
    <section className="settings-page">
      <h1>Settings</h1>
      <p className="muted">
        These apply to new chat replies in every conversation. Summaries, definitions and suggestions aren&apos;t
        affected.
      </p>

      <div className="settings-section">
        <h2>Reply detail</h2>
        <p className="muted">How long and in-depth replies are, from brief answers to exhaustive ones.</p>
        <div className="pressure-control">
          <input
            type="range"
            min={MIN_PRESSURE}
            max={MAX_PRESSURE}
            step={1}
            value={level}
            aria-label="Information pressure"
            aria-valuetext={`${level} · ${band}`}
            data-testid="pressure-slider"
            onChange={(e) => {
              const next = Number(e.target.value);
              setLevel(next);
              if (next !== stored.informationPressure) void save({ informationPressure: next });
            }}
          />
          <div className="pressure-bands" aria-hidden="true">
            {PRESSURE_BANDS.map((b) => (
              <span key={b} className="pressure-band" aria-current={b === band ? "true" : undefined}>
                {b}
              </span>
            ))}
          </div>
        </div>
        <p className="pressure-readout" data-testid="pressure-readout">
          Level {level} · {band}
        </p>
      </div>

      <div className="settings-section">
        <h2>Reply model</h2>
        <p className="muted">Which model writes chat replies. Default is the model Farabi is configured with.</p>
        <select
          aria-label="Reply model"
          data-testid="model-select"
          value={stored.replyModel}
          onChange={(e) => void save({ replyModel: e.target.value })}
        >
          {stored.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id === "default" ? "Default (the model Farabi is configured with)" : m.label}
            </option>
          ))}
        </select>
      </div>

      {status?.kind === "saved" && (
        <p className="settings-status" role="status">
          Saved
        </p>
      )}
      {status?.kind === "error" && (
        <p className="composer-error" role="alert">
          Couldn&apos;t save. Your previous setting is still in effect.
        </p>
      )}

      <KindSettingsSections />
    </section>
  );
}
