"use client";

// The composer's chip row (Feature 13, contracts/composer-ui.md): the lexicon terms attached to the
// draft, in slot order. Hovering or focusing a chip shows its card, with Swap for a neighbour.
// Since auto-detect, chips picked up from the text are marked "detected" (dashed), and a detected
// term that clashes with a chosen one is a dimmed suggestion that can be swapped in or dismissed.
import type { DraftChip, Suggestion } from "@/lib/lexiconDetect";
import { findTerm, SOFT_TERM_LIMIT, sortBySlot, unavailableReason } from "@/shared/lexicon";
import { TermCard, useHoverCard } from "./TermCard";

type Props = {
  chips: DraftChip[];
  suggestions?: Suggestion[];
  onRemove: (id: string) => void;
  onSwap: (fromId: string, toId: string) => void;
  onUseSuggestion?: (id: string) => void;
  onDismissSuggestion?: (id: string) => void;
};

const nameOf = (id: string) => findTerm(id)?.name ?? id;

export function TermChips({ chips, suggestions = [], onRemove, onSwap, onUseSuggestion, onDismissSuggestion }: Props) {
  const hover = useHoverCard();
  const via = new Map(chips.map((c) => [c.id, c.via]));
  const ids = chips.map((c) => c.id);
  const terms = sortBySlot(ids.flatMap((id) => findTerm(id) ?? []));
  if (terms.length === 0 && suggestions.length === 0) return null;
  const open = hover.open ? terms.find((t) => t.id === hover.open!.key) : undefined;

  return (
    <>
      <div className="lexicon-chips" role="list" aria-label="Attached terms" data-testid="term-chips">
        {terms.map((t) => {
          const detected = via.get(t.id) === "detected";
          return (
            <span
              key={t.id}
              role="listitem"
              className={`lexicon-chip slot-${t.slot}${detected ? " via-detected" : ""}`}
              data-testid={`term-chip-${t.id}`}
              data-via={via.get(t.id)}
              tabIndex={0}
              aria-label={detected ? `${t.name}, detected in your text` : undefined}
              aria-describedby={open?.id === t.id ? "lexicon-chip-card" : undefined}
              {...hover.anchor(t.id)}
            >
              {t.name}
              {detected && (
                <span className="lexicon-chip-via" aria-hidden="true">
                  detected
                </span>
              )}
              <button
                type="button"
                className="lexicon-chip-remove"
                aria-label={`Remove ${t.name}`}
                title={detected ? `Remove ${t.name}. It won't be picked up again for this message.` : `Remove ${t.name}`}
                onClick={() => {
                  hover.hide();
                  onRemove(t.id);
                }}
              >
                ×
              </button>
            </span>
          );
        })}
        {suggestions.map((s) => {
          const term = findTerm(s.id);
          if (!term) return null;
          const against = s.blockedBy.map(nameOf).join(", ");
          return (
            <span key={s.id} role="listitem" className="lexicon-chip suggestion" data-testid={`term-suggestion-${s.id}`}>
              <button
                type="button"
                className="lexicon-chip-swap"
                title={`Use ${term.name} instead of ${against}`}
                aria-label={`Use ${term.name} instead of ${against}`}
                onClick={() => onUseSuggestion?.(s.id)}
              >
                {term.name}
              </button>
              <span className="lexicon-chip-via">conflicts with {against}</span>
              <button
                type="button"
                className="lexicon-chip-remove"
                aria-label={`Dismiss ${term.name}`}
                title={`Dismiss ${term.name}`}
                onClick={() => onDismissSuggestion?.(s.id)}
              >
                ×
              </button>
            </span>
          );
        })}
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
                onSwap(open.id, toId);
              },
            }}
          />
        )}
      </div>
      {terms.length > SOFT_TERM_LIMIT && (
        <p className="lexicon-warning" role="status" data-testid="term-warning">
          {terms.length} terms. Long lists can blur each other; consider removing a few.
        </p>
      )}
    </>
  );
}
