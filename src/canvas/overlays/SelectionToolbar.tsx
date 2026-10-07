"use client";

// The highlighter toolbar (FR-016, FR-017; Features 2 and 8): over a valid selection inside one
// mounted element it offers Define, Branch and Park. Branch and Park first ask for an optional
// question. A selection across elements shows nothing, and an output (a leaf) offers Define only.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useDefinitionsStore } from "@/state/definitionsStore";
import { useSettingsStore } from "@/state/settingsStore";
import { useEngine, useFrame } from "../engine";
import { type SelectionAnchor, selectionToAnchor } from "../text/selection";
import { useCanvasStore } from "../store";

type Action = "branch" | "park";
const TOOLBAR_HEIGHT = 44;

/** The text a selection maps onto: the element's stored text. */
function contentOf(id: string): string | undefined {
  const el = useCanvasStore.getState().elements.get(id);
  return el?.text ?? undefined;
}

export function SelectionToolbar() {
  const engine = useEngine();
  useFrame(engine);
  // The anchor and its live DOM range; the range's box is read again on every camera frame.
  const [current, setCurrent] = useState<{ anchor: SelectionAnchor; range: Range } | null>(null);
  const anchor = current?.anchor ?? null;
  const [form, setForm] = useState<{ action: Action; question: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; href?: string; panel?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formOpen = useRef(false);

  // Follow the document selection inside the text layer.
  useEffect(() => {
    if (!engine) return;
    const root = engine.layer.root;
    const update = () => {
      if (formOpen.current) return;
      const sel = document.getSelection();
      if (!sel || sel.rangeCount === 0) return setCurrent(null);
      const range = sel.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return setCurrent(null);
      const a = selectionToAnchor(range, contentOf);
      setCurrent(a ? { anchor: a, range } : null);
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [engine]);

  // A selection keeps its element mounted wherever the camera goes (FR-034, SC-007).
  const pinned = anchor?.nodeId ?? null;
  useEffect(() => {
    if (!engine || !pinned) return;
    engine.layer.pin(pinned, "selection");
    return () => engine.layer.unpin(pinned, "selection");
  }, [engine, pinned]);

  const close = () => {
    formOpen.current = false;
    setForm(null);
    setCurrent(null);
    document.getSelection()?.removeAllRanges();
  };

  const flash = (n: { text: string; href?: string; panel?: boolean }) => {
    setNotice(n);
    setTimeout(() => setNotice(null), 4000);
  };

  async function define() {
    if (!anchor) return;
    setBusy(true);
    try {
      const { definition, created } = await api.captureDefinition({ nodeId: anchor.nodeId, start: anchor.start, end: anchor.end, text: anchor.text });
      useDefinitionsStore.getState().remember(definition);
      close();
      flash({ text: created ? `Added “${definition.term}” to Definitions` : `“${definition.term}” is already in Definitions`, href: `/definitions#${definition.id}` });
      void useDefinitionsStore.getState().refreshIndex();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the term");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!anchor || !form || !engine) return;
    const span = { start: anchor.start, end: anchor.end, text: anchor.text };
    const { action, question } = form;
    setBusy(true);
    try {
      if (action === "branch") {
        const { edge } = await api.branch(anchor.nodeId, span);
        const store = useCanvasStore.getState();
        store.merge([edge]);
        // The composer opens preloaded: the typed question, else the anchor text (FR-017).
        store.setDraft(edge.id, question.trim() ? question : anchor.text);
        close();
        engine.walkTo(edge.id);
      } else {
        // Close first: the user may select again at once, which a late close would wipe.
        close();
        await api.park(anchor.nodeId, span, question);
        flash({ text: "Parked", panel: true });
        window.dispatchEvent(new Event("farabi:panel-refresh"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : action === "branch" ? "Couldn't create the branch" : "Couldn't park this");
    } finally {
      setBusy(false);
    }
  }

  const el = anchor ? useCanvasStore.getState().elements.get(anchor.nodeId) : undefined;
  // Outputs are leaves: they anchor Define, never Branch or Park (research R12).
  const leaf = el?.origin === "run";
  const rect = current ? current.range.getBoundingClientRect() : null;
  const below = rect ? rect.top - TOOLBAR_HEIGHT - 8 < 60 : false;
  const pos = rect ? { left: Math.max(130, Math.min(rect.left + rect.width / 2, window.innerWidth - 130)), top: below ? rect.bottom + 8 : rect.top - 8 } : null;

  return (
    <>
      {notice && (
        <div className="toast" role="status" data-testid={notice.panel ? "parked-notice" : "definitions-notice"}>
          {notice.text}
          {notice.href && (
            <>
              {" · "}
              <Link href={notice.href}>Open</Link>
            </>
          )}
          {notice.panel && (
            <>
              {" · "}
              <button
                type="button"
                className="toast-link"
                onClick={() => {
                  useSettingsStore.getState().setBranchPanelOpen(true);
                  window.dispatchEvent(new CustomEvent("farabi:panel-tab", { detail: "parked" }));
                  setNotice(null);
                }}
              >
                View
              </button>
            </>
          )}
        </div>
      )}
      {error && (
        <div className="toast" role="alert" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {anchor && pos && form && (
        <form
          className={`highlight-toolbar highlight-form${below ? " below" : ""}`}
          data-testid="branch-question-form"
          data-overlay
          style={pos}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
        >
          <input
            autoFocus
            aria-label="Your question (optional)"
            placeholder="Your question (optional)"
            value={form.question}
            disabled={busy}
            onChange={(e) => setForm({ ...form, question: e.target.value })}
          />
          <button type="submit" disabled={busy}>
            {form.action === "branch" ? "Branch" : "Park"}
          </button>
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
        </form>
      )}
      {anchor && pos && !form && (
        <div
          className={`highlight-toolbar${below ? " below" : ""}`}
          role="toolbar"
          aria-label="Highlight actions"
          data-overlay
          style={pos}
          // Keep the selection alive while clicking.
          onMouseDown={(e) => e.preventDefault()}
        >
          <button type="button" disabled={busy} onClick={() => void define()} title="Add this term to Definitions">
            <span aria-hidden="true">📖</span> Define
          </button>
          {!leaf && (
            <>
              <button
                type="button"
                disabled={busy}
                title="Start a new branch from this text"
                onClick={() => {
                  formOpen.current = true;
                  setForm({ action: "branch", question: "" });
                }}
              >
                <span aria-hidden="true">⑂</span> Branch
              </button>
              <button
                type="button"
                disabled={busy}
                title="Save this text as a tangent for later"
                onClick={() => {
                  formOpen.current = true;
                  setForm({ action: "park", question: "" });
                }}
              >
                <span aria-hidden="true">🅿</span> Park
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
