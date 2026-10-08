"use client";

// The composer's chip row (Feature 13, contracts/composer-ui.md): the lexicon terms attached to the
// draft, in slot order. Hovering or focusing a chip shows its card, with Swap for a neighbour.
import { findTerm, sortBySlot, unavailableReason } from "@/shared/lexicon";
import { TermCard, useHoverCard } from "./TermCard";

export function TermChips({ ids, onChange }: { ids: string[]; onChange: (ids: string[]) => void }) {
  const hover = useHoverCard();
  const terms = sortBySlot(ids.flatMap((id) => findTerm(id) ?? []));
  if (terms.length === 0) return null;
  const open = hover.open ? terms.find((t) => t.id === hover.open!.key) : undefined;

  return (
    <div className="lexicon-chips" role="list" aria-label="Attached terms" data-testid="term-chips">
      {terms.map((t) => (
        <span
          key={t.id}
          role="listitem"
          className={`lexicon-chip slot-${t.slot}`}
          data-testid={`term-chip-${t.id}`}
          tabIndex={0}
          aria-describedby={open?.id === t.id ? "lexicon-chip-card" : undefined}
          {...hover.anchor(t.id)}
        >
          {t.name}
          <button
            type="button"
            className="lexicon-chip-remove"
            aria-label={`Remove ${t.name}`}
            title={`Remove ${t.name}`}
            onClick={() => {
              hover.hide();
              onChange(ids.filter((id) => id !== t.id));
            }}
          >
            ×
          </button>
        </span>
      ))}
      {open && hover.open && (
        <TermCard
          id="lexicon-chip-card"
          term={open}
          anchor={hover.open.el}
          hoverHandlers={hover.card}
          swap={{
            reason: (toId) => unavailableReason(toId, ids.filter((id) => id !== open.id)),
            onSwap: (toId) => {
              hover.hide();
              onChange(ids.map((id) => (id === open.id ? toId : id)));
            },
          }}
        />
      )}
    </div>
  );
}
