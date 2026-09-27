"use client";

import Link from "next/link";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { Definition } from "@/shared/schemas";
import { useDefinitionsStore } from "@/state/definitionsStore";

const HIDE_DELAY_MS = 200;
/** Holding a hover this long locks the card open; a click anywhere else unlocks and closes it. */
export const LOCK_AFTER_MS = 2000;

/**
 * Definition card shown when hovering or focusing an underlined term (FR-036b). One instance
 * serves the whole conversation; it follows `.term-mark` elements inside `containerRef`.
 */
export function TermCard({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
  const [shown, setShown] = useState<{ id: string; x: number; y: number; locked: boolean } | null>(null);
  const lockedRef = useRef(false);
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const entries = useDefinitionsStore((s) => s.entries);
  const loadEntry = useDefinitionsStore((s) => s.loadEntry);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = () => {
    if (lockTimer.current) clearTimeout(lockTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    lockedRef.current = false;
    setShown(null);
  };

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
      if (!mark?.dataset.defId || lockedRef.current) return; // a locked card stays put
      if (hideTimer.current) clearTimeout(hideTimer.current);
      const id = mark.dataset.defId;
      const rect = mark.getBoundingClientRect();
      setShown((prev) => (prev?.id === id ? prev : { id, x: rect.left, y: rect.bottom + 6, locked: false }));
      if (lockTimer.current) clearTimeout(lockTimer.current);
      lockTimer.current = setTimeout(() => {
        lockedRef.current = true;
        setShown((prev) => (prev ? { ...prev, locked: true } : prev));
      }, LOCK_AFTER_MS);
      void loadEntry(id);
    };
    const hide = (e: Event) => {
      if (!(e.target as HTMLElement).closest(".term-mark") || lockedRef.current) return;
      hideTimer.current = setTimeout(() => {
        if (lockTimer.current) clearTimeout(lockTimer.current);
        setShown(null);
      }, HIDE_DELAY_MS);
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

  // A locked card closes on a click anywhere outside it, or on Esc.
  const locked = shown?.locked ?? false;
  useEffect(() => {
    if (!locked) return;
    const onDown = (e: PointerEvent) => {
      if (!cardRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [locked]);

  if (!shown) return null;
  const def: Definition | undefined = entries[shown.id];
  return (
    <div
      ref={cardRef}
      className={`term-card${shown.locked ? " locked" : ""}`}
      role="tooltip"
      data-testid="term-card"
      data-locked={shown.locked || undefined}
      style={{ left: Math.min(shown.x, window.innerWidth - 340), top: shown.y }}
      onPointerEnter={() => hideTimer.current && clearTimeout(hideTimer.current)}
      onPointerLeave={() => !lockedRef.current && close()}
    >
      {!def ? (
        <p className="muted">Loading…</p>
      ) : (
        <DefinitionBody definition={def} />
      )}
      <Link href={`/definitions#${shown.id}`} className="term-card-link">
        Open in Definitions
      </Link>
      {/* Fills while the hover is held; at the end the circle fills and the card is locked. */}
      <div className="term-card-lock" key={shown.id} aria-hidden="true">
        <div className="term-card-lock-bar" style={{ animationDuration: `${LOCK_AFTER_MS}ms` }} />
        <svg className="term-card-lock-circle" viewBox="0 0 16 16" width="14" height="14">
          <circle cx="8" cy="8" r="6" />
        </svg>
      </div>
      {shown.locked && <span className="sr-only">Locked. Click elsewhere to close.</span>}
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
