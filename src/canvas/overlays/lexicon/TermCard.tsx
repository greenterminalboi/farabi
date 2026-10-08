"use client";

// The lexicon hover card (Feature 13, contracts/composer-ui.md "Card"): what a term will make the
// model do, with the exact text sent. Hoverable, dismissible with Escape, and kept open while the
// pointer is over it (WCAG 1.4.13).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { findTerm, roleOf, SLOT_LABEL, type Term } from "@/shared/lexicon";

/** Reveal delay for hover (research: 300–500 ms); focus opens at once. */
export const HOVER_DELAY_MS = 300;
const LEAVE_DELAY_MS = 250;

type Swap = { onSwap: (toId: string) => void; reason: (toId: string) => string | null };

/**
 * Hover and focus state for one card shared by several anchors. Returns handlers to spread on each
 * anchor and on the card, and which anchor is open.
 */
export function useHoverCard() {
  const [open, setOpen] = useState<{ key: string; el: HTMLElement } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(null);
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  return {
    open,
    anchor: (key: string) => ({
      onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
        clear();
        const el = e.currentTarget;
        timer.current = setTimeout(() => setOpen({ key, el }), HOVER_DELAY_MS);
      },
      onMouseLeave: () => {
        clear();
        timer.current = setTimeout(() => setOpen(null), LEAVE_DELAY_MS);
      },
      onFocus: (e: React.FocusEvent<HTMLElement>) => {
        clear();
        setOpen({ key, el: e.currentTarget });
      },
      onBlur: (e: React.FocusEvent<HTMLElement>) => {
        // Moving focus into the card (a Swap button) keeps it open.
        if (e.relatedTarget instanceof Node && document.querySelector("[data-term-card]")?.contains(e.relatedTarget)) return;
        clear();
        setOpen(null);
      },
    }),
    /** Opens an anchor at once (keyboard navigation in the picker). */
    show: (key: string, el: HTMLElement) => {
      clear();
      setOpen({ key, el });
    },
    hide: () => {
      clear();
      setOpen(null);
    },
    card: {
      onMouseEnter: clear,
      onMouseLeave: () => {
        clear();
        timer.current = setTimeout(() => setOpen(null), LEAVE_DELAY_MS);
      },
    },
  };
}

const CARD_WIDTH = 320;

export function TermCard({
  term,
  anchor,
  swap,
  hoverHandlers,
  id,
}: {
  term: Term;
  anchor: HTMLElement;
  swap?: Swap;
  hoverHandlers?: { onMouseEnter: () => void; onMouseLeave: () => void };
  id?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Above the anchor when there's room, else below; kept inside the viewport.
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const h = ref.current?.offsetHeight ?? 0;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - CARD_WIDTH - 8);
    const top = r.top - h - 8 >= 8 ? r.top - h - 8 : Math.min(r.bottom + 8, window.innerHeight - h - 8);
    setPos({ left, top });
  }, [anchor, term.id]);

  const role = roleOf(term);
  return (
    <div
      ref={ref}
      id={id}
      role="tooltip"
      className="term-card lexicon-card"
      data-testid="term-card"
      data-term-card
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: CARD_WIDTH }}
      {...hoverHandlers}
    >
      <div className="lexicon-card-head">
        <strong>{term.name}</strong>
        <span className={`lexicon-role role-${role}`}>
          {role === "operation" ? "Operation" : `Modifier · ${SLOT_LABEL[term.slot]}`}
        </span>
        {term.retired && <span className="lexicon-retired">retired</span>}
      </div>
      <p className="lexicon-meaning">{term.meaning}</p>
      <p className="lexicon-example">e.g. “{term.example}”</p>
      {term.neighbours.length > 0 && (
        <div className="lexicon-neighbours">
          <span className="lexicon-label">Neighbours</span>
          {term.neighbours.map((nid) => {
            const n = findTerm(nid);
            if (!n) return null;
            if (!swap) return <span key={nid} className="lexicon-neighbour">{n.name}</span>;
            const reason = swap.reason(nid);
            return (
              <button
                key={nid}
                type="button"
                className="lexicon-neighbour"
                disabled={reason !== null}
                title={reason ?? `Use ${n.name} instead of ${term.name}`}
                aria-label={`Swap for ${n.name}`}
                // WebKit doesn't focus a clicked button, so the chip's blur would close the card
                // before the click lands; keep focus on the chip instead.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => swap.onSwap(nid)}
              >
                {n.name}
              </button>
            );
          })}
        </div>
      )}
      <div className="lexicon-sent" data-testid="term-card-sent">
        <span className="lexicon-label">Sent to the model · v{term.version}</span>
        <p>{term.instruction}</p>
      </div>
    </div>
  );
}
