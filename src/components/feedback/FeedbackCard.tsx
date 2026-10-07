"use client";

import Link from "next/link";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { FeedbackItem } from "@/shared/schemas";
import { useFeedbackStore } from "@/state/feedbackStore";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const WHO = { user_authored: "you", user_confirmed: "you", ai_suggested: "Claude Code" } as const;

function ContextLabel({ context }: { context: FeedbackItem["context"] }) {
  if (context.view === "map") return <>Map</>;
  if (context.view === "definitions") return <>Definitions</>;
  // The focused element on the canvas (FR-058), or a v0.1 conversation, which /n/ still opens.
  const target = context.elementId ? `/?focus=${context.elementId}` : context.nodeId ? `/n/${context.nodeId}` : null;
  const label = context.view === "chat" ? "Chat" : "Canvas";
  if (!target) return <>{label}</>;
  return (
    <>
      {label} · <Link href={target}>{context.element ? `open ${context.element.kind}` : "open"}</Link>
    </>
  );
}

/** State as the user should read it: an `addressed` item is Claude Code's suggestion (Article I). */
function StateBadge({ state }: { state: FeedbackItem["state"] }) {
  if (state === "addressed") {
    return (
      <span className="feedback-state" data-state="addressed">
        <span className="ai-tag">AI</span>Claude Code says done — confirm?
      </span>
    );
  }
  return (
    <span className="feedback-state" data-state={state}>
      {state === "open" ? "Open" : "Resolved"}
    </span>
  );
}

type Props = {
  item: FeedbackItem;
  dragging: boolean;
  dy: number;
  dropBefore: boolean;
  dropAfter: boolean;
  onHandlePointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onHandlePointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onHandlePointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onMoveBy: (delta: -1 | 1) => void;
  onOpenImage: (url: string) => void;
  registerCard: (el: HTMLLIElement | null) => void;
};

export function FeedbackCard({
  item,
  dragging,
  dy,
  dropBefore,
  dropAfter,
  onHandlePointerDown,
  onHandlePointerMove,
  onHandlePointerUp,
  onMoveBy,
  onOpenImage,
  registerCard,
}: Props) {
  const resolve = useFeedbackStore((s) => s.resolve);
  const reopen = useFeedbackStore((s) => s.reopen);
  const classes = ["feedback-card"];
  if (dragging) classes.push("dragging");
  if (dropBefore) classes.push("drop-before");
  if (dropAfter) classes.push("drop-after");

  return (
    <li
      ref={registerCard}
      className={classes.join(" ")}
      data-testid="feedback-card"
      data-id={item.id}
      data-state={item.state}
      tabIndex={0}
      style={dragging ? { transform: `translateY(${dy}px)` } : undefined}
      onKeyDown={(e) => {
        if (!e.altKey || e.target !== e.currentTarget) return;
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          onMoveBy(e.key === "ArrowUp" ? -1 : 1);
        }
      }}
    >
      <div className="feedback-card-head">
        <button
          type="button"
          className="feedback-handle"
          aria-label="Drag to reorder"
          title="Drag to reorder (or Alt+↑ / Alt+↓)"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
        >
          ⠿
        </button>
        <StateBadge state={item.state} />
        {item.manuallyPlaced && (
          <span className="feedback-moved" title="You moved this item">
            moved
          </span>
        )}
        <span className="feedback-meta">
          <ContextLabel context={item.context} /> · {when(item.createdAt)}
        </span>
      </div>
      <p className="feedback-text">{item.text}</p>
      {item.tags.length > 0 && (
        <div className="feedback-card-tags">
          {item.tags.map((t) => (
            <span key={t.key} className="feedback-tag">
              {t.text}
            </span>
          ))}
        </div>
      )}
      {item.attachments.length > 0 && (
        <div className="feedback-thumbs">
          {item.attachments.map((a, i) => (
            <button key={a.id} type="button" className="feedback-thumb" onClick={() => onOpenImage(a.url)}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local attachment, served by our API */}
              <img src={a.thumbUrl} alt={`Screenshot ${i + 1}`} loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
      )}
      <div className="feedback-card-actions">
        {item.state === "addressed" && (
          <button type="button" className="btn btn-small btn-primary" onClick={() => void resolve(item.id)}>
            Confirm
          </button>
        )}
        {item.state === "open" && (
          <button type="button" className="btn btn-small" onClick={() => void resolve(item.id)}>
            Resolve
          </button>
        )}
        {item.state !== "open" && (
          <button type="button" className="btn btn-small" onClick={() => void reopen(item.id)}>
            Reopen
          </button>
        )}
        <details className="feedback-history">
          <summary>History</summary>
          <ol>
            {item.history.map((e, i) => (
              <li key={i}>
                {e.state} · {WHO[e.provenance]} · {when(e.at)}
              </li>
            ))}
          </ol>
        </details>
      </div>
    </li>
  );
}
