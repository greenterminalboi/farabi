"use client";

// The term picker (Feature 13, contracts/composer-ui.md "Picker"): search the lexicon by name or
// alias and add terms to the draft with the keyboard alone. Unavailable terms stay listed with the
// reason (slot already set, a conflict, the limit), so the rules are visible rather than surprising.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { activeTerms, MAX_TERMS, searchTerms, SLOT_LABEL, SLOT_ORDER, type Term, unavailableReason } from "@/shared/lexicon";
import { TermCard, useHoverCard } from "./TermCard";

type Row = { term: Term; reason: string | null };

function rowsFor(query: string, selected: string[]): Row[] {
  const found = searchTerms(query, activeTerms());
  // Browsing (no query) is grouped by slot; a search keeps its ranking.
  const ordered = query.trim() ? found : SLOT_ORDER.flatMap((slot) => found.filter((t) => t.slot === slot));
  return ordered.map((term) => ({ term, reason: unavailableReason(term.id, selected) }));
}

function firstAvailable(rows: Row[]): number {
  return Math.max(0, rows.findIndex((r) => r.reason === null));
}

export function TermPicker({
  selected,
  onAdd,
  onClose,
  placement,
}: {
  selected: string[];
  onAdd: (id: string) => void;
  onClose: () => void;
  placement: "above" | "below";
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(() => firstAvailable(rowsFor("", selected)));
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const hover = useHoverCard();
  const listId = useId();

  useEffect(() => inputRef.current?.focus(), []);

  const rows: Row[] = useMemo(() => rowsFor(query, selected), [query, selected]);

  /** A new search starts on its first available result, so Enter adds it (SC-004). */
  function search(next: string) {
    setQuery(next);
    setActive(firstAvailable(rowsFor(next, selected)));
  }

  const full = selected.length >= MAX_TERMS;
  const activeRow = rows[active];
  const optionId = (id: string) => `${listId}-${id}`;

  function move(delta: number) {
    if (rows.length === 0) return;
    const next = (active + delta + rows.length) % rows.length;
    setActive(next);
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`);
    el?.scrollIntoView({ block: "nearest" });
    if (el) hover.show(rows[next].term.id, el);
  }

  function add(row: Row | undefined) {
    if (!row || row.reason !== null) return;
    onAdd(row.term.id);
    setQuery("");
    setActive(firstAvailable(rowsFor("", [...selected, row.term.id])));
    hover.hide();
    inputRef.current?.focus();
  }

  const open = hover.open ? rows.find((r) => r.term.id === hover.open!.key) : undefined;

  return (
    <div className={`lexicon-picker placement-${placement}`} role="dialog" aria-label="Add a term" data-testid="term-picker">
      <input
        ref={inputRef}
        type="text"
        className="lexicon-search"
        aria-label="Search terms"
        placeholder="Search terms…"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={activeRow ? optionId(activeRow.term.id) : undefined}
        value={query}
        onChange={(e) => search(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            move(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            move(-1);
          } else if (e.key === "Enter") {
            e.preventDefault();
            add(activeRow);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      />
      {full && <p className="lexicon-limit" data-testid="term-limit">{MAX_TERMS} terms at most. Remove one to add another.</p>}
      <ul ref={listRef} id={listId} role="listbox" className="lexicon-options" aria-label="Terms">
        {rows.length === 0 && <li className="lexicon-empty">No term matches “{query}”.</li>}
        {rows.map((row, i) => {
          const header = !query.trim() && row.term.slot !== rows[i - 1]?.term.slot ? SLOT_LABEL[row.term.slot] : null;
          return [
            header && (
              <li key={`h-${row.term.slot}`} role="presentation" className="lexicon-group">
                {header}
              </li>
            ),
            <li
              key={row.term.id}
              id={optionId(row.term.id)}
              role="option"
              data-index={i}
              data-testid={`term-option-${row.term.id}`}
              aria-selected={i === active}
              aria-disabled={row.reason !== null}
              className={`lexicon-option${i === active ? " active" : ""}${row.reason ? " unavailable" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(row)}
              {...hover.anchor(row.term.id)}
            >
              <span className="lexicon-option-name">{row.term.name}</span>
              <span className="lexicon-option-meta">{row.reason ?? (query.trim() ? `${SLOT_LABEL[row.term.slot]} · ${row.term.meaning}` : row.term.meaning)}</span>
            </li>,
          ];
        })}
      </ul>
      {open && hover.open && <TermCard term={open.term} anchor={hover.open.el} hoverHandlers={hover.card} />}
    </div>
  );
}
