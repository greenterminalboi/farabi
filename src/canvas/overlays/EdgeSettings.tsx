"use client";

// The settings of one function edge (FR-053): an override per declared setting, applied to that
// edge's next "Run again" only. Saving never runs anything.
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { getKind } from "@/shared/kinds";
import type { ResolvedSetting } from "@/shared/schemas";
import { useEngine, useFrame } from "../engine";

const DEFAULT = "";

export function EdgeSettings() {
  const engine = useEngine();
  useFrame(engine);
  const [open, setOpen] = useState<{ edgeId: string; kind: string; settings: ResolvedSetting[] } | null>(null);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onAction = (e: Event) => {
      const { action, id } = (e as CustomEvent<{ action: string; id: string }>).detail;
      if (action !== "edge-settings") return;
      setError(false);
      api.edgeSettings(id).then(
        (r) => setOpen({ edgeId: id, ...r }),
        () => setError(true),
      );
    };
    window.addEventListener("farabi:element-action", onAction);
    return () => window.removeEventListener("farabi:element-action", onAction);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (ref.current?.contains(t) || t.closest?.('[data-action="edge-settings"]')) return;
      setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!open || !engine) return null;
  const rect = engine.screenRect(open.edgeId);
  const host = engine.renderer.canvas?.getBoundingClientRect();
  if (!rect || !host) return null;
  const decl = getKind(open.kind);

  async function save(key: string, value: string | null) {
    if (!open) return;
    setError(false);
    try {
      await api.saveEdgeSetting(open.edgeId, key, value);
      const r = await api.edgeSettings(open.edgeId);
      setOpen({ edgeId: open.edgeId, ...r });
    } catch {
      setError(true);
    }
  }

  return (
    <div
      ref={ref}
      className="function-menu node-settings edge-settings"
      data-testid="edge-settings"
      data-overlay
      style={{ left: host.left + rect.x, top: host.top + rect.y + rect.h + 6 }}
    >
      <strong>Settings for this {decl.label.toLowerCase()} run</strong>
      {decl.settings.map((s) => {
        const resolved = open.settings.find((r) => r.key === s.key);
        const inherited = s.choices.find((c) => c.value === (resolved?.kindValue ?? s.default))?.label ?? s.default;
        const overriding = resolved?.source === "override";
        return (
          <label key={s.key}>
            {s.label}
            <select
              data-testid={`edge-setting-${s.key}`}
              value={overriding ? resolved.value : DEFAULT}
              onChange={(e) => void save(s.key, e.target.value === DEFAULT ? null : e.target.value)}
            >
              <option value={DEFAULT}>Use the {decl.label.toLowerCase()} setting ({inherited})</option>
              {s.choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      <p className="muted">Used the next time you choose Run again here. Saving runs nothing.</p>
      {error && (
        <p className="composer-error" role="alert">
          Couldn&apos;t save. The previous setting is still in effect.
        </p>
      )}
    </div>
  );
}
