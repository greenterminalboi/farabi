"use client";

import { useMemo } from "react";
import { useFeedbackStore } from "@/state/feedbackStore";

/** One tag at a time, matched by normalised key (FR-010). Filtering never changes order. */
export function TagFilter() {
  const items = useFeedbackStore((s) => s.items);
  const filterKey = useFeedbackStore((s) => s.filterKey);
  const setFilter = useFeedbackStore((s) => s.setFilter);

  const tags = useMemo(() => {
    const byKey = new Map<string, { text: string; count: number }>();
    // Oldest first, so each chip shows the first spelling the user typed.
    for (const item of [...items].reverse()) {
      for (const t of item.tags) {
        const entry = byKey.get(t.key);
        if (entry) entry.count += 1;
        else byKey.set(t.key, { text: t.text, count: 1 });
      }
    }
    return [...byKey].sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  if (tags.length === 0) return null;
  return (
    <div className="feedback-filter" role="group" aria-label="Filter by tag">
      <button type="button" className="feedback-chip" aria-pressed={filterKey === null} onClick={() => setFilter(null)}>
        All
      </button>
      {tags.map(([key, { text, count }]) => (
        <button
          key={key}
          type="button"
          className="feedback-chip"
          aria-pressed={filterKey === key}
          onClick={() => setFilter(filterKey === key ? null : key)}
        >
          {text} <span className="feedback-chip-count">{count}</span>
        </button>
      ))}
    </div>
  );
}
