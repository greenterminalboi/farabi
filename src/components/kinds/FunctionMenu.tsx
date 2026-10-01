"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { FunctionsResponse, MapNode } from "@/shared/schemas";

type Fn = FunctionsResponse["functions"][number];
type Status =
  | { kind: "idle" }
  | { kind: "running"; id: string }
  | { kind: "done"; name: string; output: MapNode }
  | { kind: "error"; id: string; message: string };

/**
 * The functions that can run on a node (Feature 9, contracts/ui.md). Only functions that accept the
 * node's kind are listed; one that can't run yet says why. Nothing runs until the user picks one.
 */
export function FunctionMenu({
  nodeId,
  onDone,
  onClose,
  showOpenLink,
  style,
}: {
  nodeId: string;
  onDone?: (output: MapNode) => void;
  onClose: () => void;
  showOpenLink: boolean;
  style?: React.CSSProperties;
}) {
  const [functions, setFunctions] = useState<Fn[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listFunctions(nodeId).then(
      (r) => setFunctions(r.functions),
      () => setLoadError(true),
    );
  }, [nodeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element;
      // The button that toggles the menu handles its own clicks.
      if (ref.current?.contains(target) || target.closest?.("[data-function-menu-anchor]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);

  async function run(fn: Fn) {
    if (status.kind === "running") return;
    setStatus({ kind: "running", id: fn.id });
    try {
      const { output } = await api.runFunction(nodeId, fn.id);
      setStatus({ kind: "done", name: fn.name, output });
      onDone?.(output);
    } catch (err) {
      setStatus({ kind: "error", id: fn.id, message: err instanceof ApiError ? err.message : "Couldn't run it" });
    }
  }

  return (
    <div ref={ref} className="function-menu" role="menu" data-testid="function-menu" style={style}>
      {functions === null && <p className="muted">{loadError ? "Couldn't load functions" : "Loading…"}</p>}
      {functions?.length === 0 && <p className="muted">No functions for this kind of node</p>}
      {functions?.map((fn) => (
        <div key={fn.id} className="function-item">
          <button
            type="button"
            role="menuitem"
            className="btn btn-small"
            data-testid={`function-item-${fn.id}`}
            disabled={!fn.available || status.kind === "running"}
            onClick={() => void run(fn)}
          >
            {status.kind === "running" && status.id === fn.id ? "Working…" : fn.name}
          </button>
          {!fn.available && fn.reason && (
            <p className="function-reason muted" data-testid="function-unavailable-reason">
              {fn.reason}
            </p>
          )}
        </div>
      ))}
      {status.kind === "done" && showOpenLink && (
        <p className="function-done">
          {status.name} ready ·{" "}
          <Link href={`/n/${status.output.id}`} data-testid="function-open-output">
            Open
          </Link>
        </p>
      )}
      {status.kind === "error" && (
        <p className="function-error" role="alert" data-testid="function-error">
          {status.message}{" "}
          <button
            type="button"
            className="btn btn-small"
            data-testid="function-retry"
            onClick={() => {
              const fn = functions?.find((f) => f.id === status.id);
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
