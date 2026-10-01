"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { getKind } from "@/shared/kinds";
import type { ResolvedSetting } from "@/shared/schemas";

const DEFAULT = "";

/**
 * One node's overrides of its kind's settings (Feature 9, FR-031). Saving never runs anything; the
 * next regeneration of this node uses the new value (FR-032).
 */
export function NodeSettings({
  nodeId,
  kind,
  settings,
  onSaved,
}: {
  nodeId: string;
  kind: string;
  settings: ResolvedSetting[];
  onSaved: (settings: ResolvedSetting[]) => void;
}) {
  const [error, setError] = useState(false);
  const decl = getKind(kind);
  if (decl.settings.length === 0) return null;

  async function save(key: string, value: string | null) {
    setError(false);
    try {
      onSaved((await api.saveNodeSetting(nodeId, key, value)).settings);
    } catch {
      setError(true);
    }
  }

  return (
    <details className="node-settings" data-testid="node-settings">
      <summary>Settings for this {decl.label.toLowerCase()}</summary>
      {decl.settings.map((s) => {
        const resolved = settings.find((r) => r.key === s.key);
        const inherited = s.choices.find((c) => c.value === (resolved?.kindValue ?? s.default))?.label ?? s.default;
        const overriding = resolved?.source === "override";
        return (
          <label key={s.key}>
            {s.label}
            <select
              data-testid={`node-setting-${s.key}`}
              value={overriding ? resolved.value : DEFAULT}
              onChange={(e) => void save(s.key, e.target.value === DEFAULT ? null : e.target.value)}
            >
              <option value={DEFAULT}>Use default ({inherited})</option>
              {s.choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            {overriding && (
              <span className="override-note" data-testid={`node-setting-override-note-${s.key}`}>
                Overriding the setting for all {decl.label.toLowerCase()}s
              </span>
            )}
          </label>
        );
      })}
      {error && (
        <p className="composer-error" role="alert">
          Couldn&apos;t save. The previous setting is still in effect.
        </p>
      )}
    </details>
  );
}
