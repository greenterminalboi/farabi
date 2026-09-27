"use client";

import Link from "next/link";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { Definition } from "@/shared/schemas";
import { useDefinitionsStore } from "@/state/definitionsStore";

const HIDE_DELAY_MS = 200;

/**
 * Definition card shown when hovering or focusing an underlined term (FR-036b). One instance
 * serves the whole conversation; it follows `.term-mark` elements inside `containerRef`.
 */
export function TermCard({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
  const [shown, setShown] = useState<{ id: string; x: number; y: number } | null>(null);
  const entries = useDefinitionsStore((s) => s.entries);
  const loadEntry = useDefinitionsStore((s) => s.loadEntry);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Preload the definitions of terms visible in this conversation, so a hover shows the card at
  // once instead of waiting for a request (SC-009a).
  const matcher = useDefinitionsStore((s) => s.matcher);
  useEffect(() => {
    const root = containerRef.current;
    if (!root || !matcher) return;
    const timer = setTimeout(() => {
      const known = useDefinitionsStore.getState().entries;
      const ids = new Set(
        Array.from(root.querySelectorAll<HTMLElement>(".term-mark"), (el) => el.dataset.defId!).filter(Boolean),
      );
      [...ids].filter((id) => !known[id]).slice(0, 50).forEach((id) => void loadEntry(id));
    }, 100);
    return () => clearTimeout(timer);
  }, [containerRef, matcher, loadEntry]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const show = (e: Event) => {
      const mark = (e.target as HTMLElement).closest<HTMLElement>(".term-mark");
      if (!mark?.dataset.defId) return;
      if (hideTimer.current) clearTimeout(hideTimer.current);
      const rect = mark.getBoundingClientRect();
      setShown({ id: mark.dataset.defId, x: rect.left, y: rect.bottom + 6 });
      void loadEntry(mark.dataset.defId);
    };
    const hide = (e: Event) => {
      if (!(e.target as HTMLElement).closest(".term-mark")) return;
      hideTimer.current = setTimeout(() => setShown(null), HIDE_DELAY_MS);
    };
    root.addEventListener("pointerover", show);
    root.addEventListener("focusin", show);
    root.addEventListener("pointerout", hide);
    root.addEventListener("focusout", hide);
    return () => {
      root.removeEventListener("pointerover", show);
      root.removeEventListener("focusin", show);
      root.removeEventListener("pointerout", hide);
      root.removeEventListener("focusout", hide);
    };
  }, [containerRef, loadEntry]);

  if (!shown) return null;
  const def: Definition | undefined = entries[shown.id];
  return (
    <div
      className="term-card"
      role="tooltip"
      data-testid="term-card"
      style={{ left: Math.min(shown.x, window.innerWidth - 340), top: shown.y }}
      onPointerEnter={() => hideTimer.current && clearTimeout(hideTimer.current)}
      onPointerLeave={() => setShown(null)}
    >
      {!def ? (
        <p className="muted">Loading…</p>
      ) : (
        <DefinitionBody definition={def} />
      )}
      <Link href={`/definitions#${shown.id}`} className="term-card-link">
        Open in Definitions
      </Link>
    </div>
  );
}

export function StatusBadge({ status }: { status: Definition["status"] }) {
  const label = { drafting: "Being drafted", failed: "Couldn't draft", draft: "Draft", confirmed: "Confirmed" }[status];
  return <span className={`def-badge def-${status}`}>{label}</span>;
}

export function DefinitionBody({ definition }: { definition: Definition }) {
  return (
    <>
      <div className="term-card-head">
        <strong>{definition.term}</strong>
        <StatusBadge status={definition.status} />
      </div>
      {definition.current ? (
        <>
          <p>
            <span className="def-part">General</span> {definition.current.generalText}
          </p>
          <p>
            <span className="def-part">In your conversation</span> {definition.current.usageText}
          </p>
        </>
      ) : (
        <p className="muted">
          {definition.status === "drafting" ? "The definition is being drafted…" : "No definition yet."}
        </p>
      )}
    </>
  );
}
