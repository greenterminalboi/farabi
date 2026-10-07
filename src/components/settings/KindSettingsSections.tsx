"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { findKind } from "@/shared/kinds";
import type { KindSettingsResponse } from "@/shared/schemas";

/**
 * One section per node kind that declares settings, generated from the declarations (Feature 9,
 * FR-031, SC-007). A new kind's section appears here with no edit to this page.
 */
export function KindSettingsFields({
  data,
  onChange,
}: {
  data: KindSettingsResponse;
  onChange: (kind: string, key: string, value: string) => void;
}) {
  const sections = data.kinds.flatMap(({ kind, settings }) => {
    const decl = findKind(kind);
    return decl && decl.settings.length > 0 ? [{ decl, settings }] : [];
  });
  if (sections.length === 0) return null;
  return (
    <div className="kind-settings">
      <h2>Node kinds</h2>
      <p className="muted">These apply the next time something of that kind is made. Changing them runs nothing.</p>
      {sections.map(({ decl, settings }) => (
        <div key={decl.id} className="settings-section" data-testid={`kind-settings-${decl.id}`}>
          <h3>{decl.label}</h3>
          {decl.settings.map((s) => (
            <label key={s.key} className="kind-setting">
              <span>{s.label}</span>
              <span className="muted">{s.help}</span>
              <select
                data-testid={`kind-setting-${decl.id}-${s.key}`}
                value={settings.find((r) => r.key === s.key)?.value ?? s.default}
                onChange={(e) => onChange(decl.id, s.key, e.target.value)}
              >
                {s.choices.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                    {c.value === s.default ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

type Status = { kind: "saved" } | { kind: "error" } | null;

export function KindSettingsSections() {
  const [data, setData] = useState<KindSettingsResponse | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    api.getKindSettings().then(setData, () => setStatus({ kind: "error" }));
    return () => clearTimeout(timer.current);
  }, []);

  async function save(kind: string, key: string, value: string) {
    setStatus(null);
    clearTimeout(timer.current);
    try {
      await api.saveKindSetting(kind, key, value);
      setData(await api.getKindSettings());
      setStatus({ kind: "saved" });
      timer.current = setTimeout(() => setStatus(null), 2000);
    } catch {
      setData(await api.getKindSettings().catch(() => data));
      setStatus({ kind: "error" });
    }
  }

  if (!data) return null;
  return (
    <>
      <KindSettingsFields data={data} onChange={(kind, key, value) => void save(kind, key, value)} />
      {status?.kind === "saved" && (
        <p className="settings-status" role="status" data-testid="kind-settings-saved">
          Saved
        </p>
      )}
      {status?.kind === "error" && (
        <p className="composer-error" role="alert">
          Couldn&apos;t save. Your previous setting is still in effect.
        </p>
      )}
    </>
  );
}
