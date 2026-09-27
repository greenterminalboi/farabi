"use client";

import { type PointerEvent as ReactPointerEvent, useRef, useState } from "react";
import { useFeedbackStore, visibleItems } from "@/state/feedbackStore";
import { FeedbackCard } from "./FeedbackCard";

type Drag = {
  id: string;
  pointerId: number;
  startY: number;
  startScroll: number;
  dy: number;
  fromIndex: number;
  /** Target position among the other visible items. */
  toIndex: number;
};

const EDGE = 40;
const SCROLL_STEP = 14;

/** The list in panel order, with drag-to-reorder by handle (research R10). */
export function FeedbackList({ onOpenImage }: { onOpenImage: (url: string) => void }) {
  const items = useFeedbackStore((s) => s.items);
  const loaded = useFeedbackStore((s) => s.loaded);
  const filterKey = useFeedbackStore((s) => s.filterKey);
  const move = useFeedbackStore((s) => s.move);
  const [drag, setDrag] = useState<Drag | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const registerCards = useRef(new Map<string, HTMLLIElement>());

  const visible = visibleItems(items, filterKey);
  const visibleIds = visible.map((i) => i.id);

  const targetIndex = (id: string, clientY: number): number => {
    const list = listRef.current!;
    const y = clientY - list.getBoundingClientRect().top + list.scrollTop;
    let index = 0;
    for (const other of visibleIds) {
      if (other === id) continue;
      const el = registerCards.current.get(other);
      if (el && el.offsetTop + el.offsetHeight / 2 < y) index += 1;
    }
    return index;
  };

  const onDown = (id: string) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || !listRef.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const fromIndex = visibleIds.indexOf(id);
    setDrag({
      id,
      pointerId: e.pointerId,
      startY: e.clientY,
      startScroll: listRef.current.scrollTop,
      dy: 0,
      fromIndex,
      toIndex: fromIndex,
    });
  };

  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const list = listRef.current;
    if (!drag || e.pointerId !== drag.pointerId || !list) return;
    const rect = list.getBoundingClientRect();
    if (e.clientY < rect.top + EDGE) list.scrollTop -= SCROLL_STEP;
    else if (e.clientY > rect.bottom - EDGE) list.scrollTop += SCROLL_STEP;
    const dy = e.clientY + list.scrollTop - (drag.startY + drag.startScroll);
    setDrag({ ...drag, dy, toIndex: targetIndex(drag.id, e.clientY) });
  };

  const onUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { id, fromIndex, toIndex } = drag;
    setDrag(null);
    if (toIndex !== fromIndex) void move(id, toIndex, visibleIds);
  };

  const moveBy = (id: string, delta: -1 | 1) => {
    const index = visibleIds.indexOf(id);
    const to = index + delta;
    if (to < 0 || to >= visibleIds.length) return;
    void move(id, to, visibleIds).then(() => {
      requestAnimationFrame(() => registerCards.current.get(id)?.focus());
    });
    requestAnimationFrame(() => registerCards.current.get(id)?.focus());
  };

  if (!loaded) return <p className="feedback-empty">Loading…</p>;
  if (items.length === 0) return <p className="feedback-empty">No feedback yet.</p>;

  // Where the drop line goes: before the item now at `toIndex` among the others, or after the last.
  const others = drag ? visibleIds.filter((v) => v !== drag.id) : [];
  const dropBeforeId = drag && drag.toIndex !== drag.fromIndex ? (others[drag.toIndex] ?? null) : null;
  const dropAfterLast = drag !== null && drag.toIndex !== drag.fromIndex && drag.toIndex >= others.length;

  return (
    <ol className="feedback-list" ref={listRef} aria-label="Feedback items">
      {visible.map((item) => (
        <FeedbackCard
          key={item.id}
          item={item}
          dragging={drag?.id === item.id}
          dy={drag?.id === item.id ? drag.dy : 0}
          dropBefore={dropBeforeId === item.id}
          dropAfter={dropAfterLast && item.id === others[others.length - 1]}
          onHandlePointerDown={onDown(item.id)}
          onHandlePointerMove={onMove}
          onHandlePointerUp={onUp}
          onMoveBy={(delta) => moveBy(item.id, delta)}
          onOpenImage={onOpenImage}
          registerCard={(el) => {
            if (el) registerCards.current.set(item.id, el);
            else registerCards.current.delete(item.id);
          }}
        />
      ))}
    </ol>
  );
}
