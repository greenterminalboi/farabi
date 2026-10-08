"use client";

// The composer (research R12; contracts/canvas-ui.md "Composer"): a screen-space overlay pinned
// below the focused element, or docked to the viewport edge with a pointer when the element is off
// screen. It never scales, so it stays usable at every zoom. Drafts are kept per target.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { Element } from "@/shared/schemas";
import { type CanvasEngine, useEngine, useFrame } from "../engine";
import { NEW_TREE, newestAnswer, useCanvasStore } from "../store";
import { TermChips } from "./lexicon/TermChips";
import { TermPicker } from "./lexicon/TermPicker";
import { findTerm } from "@/shared/lexicon";

/** Persisted chip ids that still name a term that can be sent (Feature 13). */
function liveTerms(ids: string[] | undefined): string[] {
  return (ids ?? []).filter((id) => {
    const t = findTerm(id);
    return t && !t.retired;
  });
}
const NO_TERMS: string[] = [];

const QUICK_BRANCH = "????";
const WIDTH = 440;
const GAP = 14;
const EDGE = 12;

type Target =
  | { kind: "new-tree"; key: string }
  | { kind: "ask"; key: string; from: Element }
  | { kind: "send"; key: string; edge: Element };

/** What the composer sends to, from the focus (FR-010). Outputs and function edges have none. */
export function composerTarget(focusId: string | null, composingNewTree: boolean, elements: Map<string, Element>): Target | null {
  if (composingNewTree || elements.size === 0) return { kind: "new-tree", key: NEW_TREE };
  const el = focusId ? elements.get(focusId) : undefined;
  if (!el) return null;
  if (el.kind === "answer") {
    // A failed reply has no text to ask from: the next message follows its question instead.
    if (el.status === "failed" && el.parentId) {
      const edge = elements.get(el.parentId);
      return edge ? { kind: "ask", key: edge.id, from: edge } : null;
    }
    return { kind: "ask", key: el.id, from: el };
  }
  if (el.kind === "question") return el.text === null ? { kind: "send", key: el.id, edge: el } : { kind: "ask", key: el.id, from: el };
  return null;
}

const PLACEHOLDER: Record<string, string> = {
  "new-tree": "Start a new tree…",
  answer: "Ask a follow-up…",
  edge: "Send your next message…",
  send: "Ask about the highlighted text…",
};

/** Typing exactly "????" re-asks at once when the focused answer's question can be re-asked (FR-020). */
function canQuickBranch(target: Target | null, elements: Map<string, Element>): boolean {
  if (target?.kind !== "ask" || target.from.kind !== "answer" || !target.from.parentId) return false;
  const edge = elements.get(target.from.parentId);
  if (!edge || edge.kind !== "question" || edge.parentId === null) return false;
  for (const e of elements.values()) if (e.requeryOf === edge.id) return false;
  return true;
}

/** The answer a Stop would stop: the target's own pending reply. */
function streamingAnswer(target: Target | null, elements: Map<string, Element>): Element | null {
  if (!target || target.kind === "new-tree") return null;
  const el = target.kind === "ask" ? target.from : target.edge;
  if (el.kind === "answer") return el.status === "pending" ? el : null;
  const newest = newestAnswer(el.id, elements.values());
  return newest?.status === "pending" ? newest : null;
}

function place(engine: CanvasEngine | null, target: Target | null, height: number) {
  if (!engine) return { left: 0, top: 0, docked: false, pointer: "none" as const };
  const { width, height: H } = engine.size();
  const centred = { left: Math.max(EDGE, (width - WIDTH) / 2), top: H - height - 28, docked: false, pointer: "none" as const };
  if (!target || target.kind === "new-tree") {
    if (useCanvasStore.getState().elements.size === 0) return { ...centred, top: H / 2 + 16 };
    return centred;
  }
  const id = target.kind === "ask" ? target.from.id : target.edge.id;
  const r = engine.screenRect(id);
  if (!r) return centred;
  let left = r.x + r.w / 2 - WIDTH / 2;
  let top = r.y + r.h + GAP;
  const offscreen = r.y + r.h < 0 || r.y > H || r.x + r.w < 0 || r.x > width || top + height > H - EDGE;
  let pointer: "up" | "down" | "left" | "right" | "none" = "none";
  if (offscreen) {
    // Dock to the nearest edge and point toward the element.
    if (r.y > H - height) pointer = "down";
    else if (r.y + r.h < 0) pointer = "up";
    else if (r.x + r.w < 0) pointer = "left";
    else if (r.x > width) pointer = "right";
    else pointer = "down";
    top = H - height - EDGE;
  }
  left = Math.min(Math.max(EDGE, left), width - WIDTH - EDGE);
  top = Math.min(Math.max(EDGE, top), H - height - EDGE);
  return { left, top, docked: offscreen, pointer };
}

export function Composer() {
  const engine = useEngine();
  useFrame(engine);
  const focusId = useCanvasStore((s) => s.focusId);
  const composingNewTree = useCanvasStore((s) => s.composingNewTree);
  const elements = useCanvasStore((s) => s.elements);
  const projectId = useCanvasStore((s) => s.projectId);
  const target = composerTarget(focusId, composingNewTree, elements);
  const key = target?.key ?? "";
  const draft = useCanvasStore((s) => (key ? (s.drafts[key] ?? "") : ""));
  const setDraft = useCanvasStore((s) => s.setDraft);
  // Lexicon chips on this draft (Feature 13); kept and cleared with the draft's text.
  const storedTerms = useCanvasStore((s) => (key ? (s.draftTerms[key] ?? NO_TERMS) : NO_TERMS));
  const setDraftTerms = useCanvasStore((s) => s.setDraftTerms);
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  // An error belongs to the target it happened on; switching target hides it.
  const [failure, setError] = useState<{ key: string; message: string; content: string } | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(56);

  const streaming = streamingAnswer(target, elements);
  const quick = canQuickBranch(target, elements);

  // The box grows with its text up to its max height, then scrolls (Feature 7).
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.style.height = "auto";
    const max = parseFloat(getComputedStyle(box).maxHeight) || Infinity;
    box.style.height = `${Math.min(box.scrollHeight + 2, max)}px`;
    box.classList.toggle("overflowing", box.scrollHeight + 2 > max);
    setHeight(formRef.current?.offsetHeight ?? 56);
  }, [draft, failure, storedTerms]);

  // A composer with text keeps its element mounted wherever the camera goes (FR-034, SC-007).
  const pinId = target && target.kind !== "new-tree" ? (target.kind === "ask" ? target.from.id : target.edge.id) : null;
  useEffect(() => {
    if (!engine || !pinId || !draft) return;
    engine.layer.pin(pinId, "composer");
    return () => engine.layer.unpin(pinId, "composer");
  }, [engine, pinId, draft]);

  // "/" focuses the composer.
  useEffect(() => {
    if (!engine) return;
    const focus = () => boxRef.current?.focus();
    window.addEventListener("farabi:focus-composer", focus);
    return () => window.removeEventListener("farabi:focus-composer", focus);
  }, [engine]);

  if (!target) return null;
  const error = failure?.key === target.key ? failure : null;

  const terms = liveTerms(storedTerms);

  async function send(content: string): Promise<boolean> {
    if (!target || !content.trim() || sending) return false;
    setSending(true);
    setError(null);
    const store = useCanvasStore.getState();
    try {
      let created: { edge: Element; answer: Element };
      if (target.kind === "new-tree") {
        if (!projectId) return false;
        const res = await api.startTree(projectId, content, terms);
        store.merge([res.edge, res.answer], [res.tree]);
        created = res;
      } else if (target.kind === "send") {
        created = await api.sendUnsent(target.edge.id, content, terms);
        store.merge([created.edge, created.answer]);
      } else {
        created = await api.ask(target.from.id, content, terms);
        store.merge([created.edge, created.answer]);
      }
      // Cleared only once the server stored the message (FR-015).
      store.setDraft(target.key, "");
      store.setDraftTerms(target.key, []);
      setPicking(false);
      store.setComposingNewTree(false);
      engine?.walkTo(created.answer.id);
      return true;
    } catch (err) {
      setError({ key: target.key, message: err instanceof ApiError ? err.message : "Couldn't send. Your message is kept; try again.", content });
      return false;
    } finally {
      setSending(false);
    }
  }

  const pos = place(engine, target, height);
  const display = target.kind === "ask" ? (target.from.kind === "answer" ? "answer" : "edge") : target.kind;
  return (
    <div
      ref={formRef}
      className="canvas-composer"
      data-testid="composer"
      data-overlay
      data-docked={pos.docked ? "true" : "false"}
      data-pointer={pos.pointer}
      data-target={pinId ?? NEW_TREE}
      style={{ left: pos.left, top: pos.top, width: WIDTH }}
    >
      {error && (
        <div className="composer-error" role="alert">
          <span>{error.message}</span>
          <button type="button" className="btn btn-small" onClick={() => void send(error.content)}>
            Retry
          </button>
        </div>
      )}
      {picking && (
        <TermPicker
          selected={terms}
          placement={pos.top > 360 ? "above" : "below"}
          onAdd={(id) => setDraftTerms(target.key, [...terms, id])}
          onClose={() => {
            setPicking(false);
            boxRef.current?.focus();
          }}
        />
      )}
      <TermChips ids={terms} onChange={(ids) => setDraftTerms(target.key, ids)} />
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <textarea
          ref={boxRef}
          rows={1}
          aria-label="Message"
          value={draft}
          placeholder={PLACEHOLDER[display]}
          onChange={(e) => {
            const value = e.target.value;
            setDraft(target.key, value);
            if (value.trim() === QUICK_BRANCH && quick && !sending) void send(value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!streaming) void send(draft);
            }
          }}
        />
        {/* Feature 13: lexicon terms are added only from here, never detected in the text. */}
        <button
          type="button"
          className={`composer-icon-btn composer-terms${picking ? " active" : ""}`}
          aria-label="Add a term"
          aria-expanded={picking}
          title="Add a lexicon term"
          data-testid="term-picker-open"
          onClick={() => setPicking((p) => !p)}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path d="M2.5 3.5h6l5 5-5 5-6-6v-4z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            <circle cx="5.5" cy="6.5" r="1.1" fill="currentColor" />
          </svg>
        </button>
        {/* Icon-only, inside the box; the aria-labels keep them named "Stop" and "Send" (Feature 7). */}
        {streaming ? (
          <button
            type="button"
            className="composer-icon-btn composer-stop"
            onClick={() => void api.stop(streaming.id).then((r) => useCanvasStore.getState().merge([r.answer]), () => {})}
            aria-label="Stop"
            title="Stop"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor" />
            </svg>
          </button>
        ) : (
          <button type="submit" className="composer-icon-btn composer-send" disabled={sending || !draft.trim()} aria-label="Send" title="Send">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M8 12.5V3.5M3.75 7.75 8 3.5l4.25 4.25" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </form>
    </div>
  );
}
