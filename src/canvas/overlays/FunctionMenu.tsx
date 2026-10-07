"use client";

// The functions that can run on an answer (story 8; Feature 9 re-expressed): opened from ƒ in the
// answer's frame. Only functions that accept its kind are listed, and nothing runs until the user
// picks one. A run creates a function edge and its first output; their arrival never moves the
// camera (FR-025). A failure creates nothing and offers Retry (FR-052).
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { FunctionsResponse } from "@/shared/schemas";
import { useEngine, useFrame } from "../engine";
import { useCanvasStore } from "../store";

type Fn = FunctionsResponse["functions"][number];
type Status = { kind: "idle" } | { kind: "running"; id: string } | { kind: "error"; id: string; message: string };

export function FunctionMenu() {
  const engine = useEngine();
  useFrame(engine);
  const [target, setTarget] = useState<string | null>(null);
  const [functions, setFunctions] = useState<{ for: string; list: Fn[] } | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const open = (e: Event) => {
      const { action, id } = (e as CustomEvent<{ action: string; id: string }>).detail;
      if (action !== "functions") return;
      setStatus({ kind: "idle" });
      setTarget(id);
      api.listFunctions(id).then(
        (r) => setFunctions({ for: id, list: r.functions }),
        () => setFunctions({ for: id, list: [] }),
      );
    };
    window.addEventListener("farabi:element-action", open);
    return () => window.removeEventListener("farabi:element-action", open);
  }, []);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTarget(null);
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (ref.current?.contains(t) || t.closest?.('[data-action="functions"]')) return;
      setTarget(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [target]);

  if (!target || !engine) return null;
  const rect = engine.screenRect(target);
  const host = engine.renderer.canvas?.getBoundingClientRect();
  if (!rect || !host) return null;
  const list = functions?.for === target ? functions.list : null;

  async function run(fn: Fn) {
    if (!target || status.kind === "running") return;
    setStatus({ kind: "running", id: fn.id });
    try {
      const { edge, output } = await api.runFunction(target, fn.id);
      useCanvasStore.getState().merge([edge, output]);
      setTarget(null);
      setStatus({ kind: "idle" });
    } catch (err) {
      setStatus({ kind: "error", id: fn.id, message: err instanceof ApiError ? err.message : "Couldn't run it" });
    }
  }

  return (
    <div
      ref={ref}
      className="function-menu canvas-function-menu"
      role="menu"
      data-testid="function-menu"
      data-overlay
      style={{ left: host.left + rect.x + rect.w - 220, top: host.top + rect.y + 32 }}
    >
      {list === null && <p className="muted">Loading…</p>}
      {list?.length === 0 && <p className="muted">No functions for this kind of element</p>}
      {list?.map((fn) => (
        <div key={fn.id} className="function-item">
          <button
            type="button"
            role="menuitem"
            className="btn btn-small"
            data-testid={`function-item-${fn.id}`}
            disabled={status.kind === "running"}
            onClick={() => void run(fn)}
          >
            {status.kind === "running" && status.id === fn.id ? "Working…" : fn.name}
          </button>
        </div>
      ))}
      {status.kind === "error" && (
        <p className="function-error" role="alert" data-testid="function-error">
          {status.message}{" "}
          <button
            type="button"
            className="btn btn-small"
            data-testid="function-retry"
            onClick={() => {
              const fn = list?.find((f) => f.id === status.id);
              if (fn) void run(fn);
            }}
          >
            Retry
          </button>
        </p>
      )}
    </div>
  );
}
