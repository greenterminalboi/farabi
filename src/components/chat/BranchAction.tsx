"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type RefObject, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Anchor } from "@/shared/schemas";
import { useDefinitionsStore } from "@/state/definitionsStore";
import { useSettingsStore } from "@/state/settingsStore";
import { useViewStore } from "@/state/viewStore";
import { selectionToAnchor } from "./selection";

type Props = {
  nodeId: string;
  containerRef: RefObject<HTMLElement | null>;
  contentOf: (messageId: string) => string | undefined;
  onError: (message: string) => void;
  /** A tangent was parked; the chat reloads so the Parked tab shows it (Feature 8). */
  onParked: () => void;
};

type Action = "branch" | "park";

const TOOLBAR_HEIGHT = 44;

/**
 * The highlighter toolbar: appears over a valid selection inside one message with its actions,
 * Define (send the term to Definitions), Branch (FR-002) and Park (Feature 8). Branch and Park
 * then ask for an optional question in the toolbar itself (Feature 8, FR-008).
 */
export function BranchAction({ nodeId, containerRef, contentOf, onError, onParked }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<{ anchor: Anchor; x: number; y: number; below: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; id: string } | null>(null);
  const [parkedNotice, setParkedNotice] = useState(false);
  // The question step of Branch or Park. While it's open the captured anchor stays put, even though
  // the document selection moves into the input (contracts/ui.md).
  const [form, setForm] = useState<{ action: Action; question: string } | null>(null);
  const formOpen = useRef(false);
  const setPanelTab = useViewStore((s) => s.setPanelTab);
  const setDraft = useViewStore((s) => s.setDraft);
  const setBranchPanelOpen = useSettingsStore((s) => s.setBranchPanelOpen);
  const refreshIndex = useDefinitionsStore((s) => s.refreshIndex);
  const remember = useDefinitionsStore((s) => s.remember);

  useEffect(() => {
    const update = () => {
      if (formOpen.current) return;
      const sel = document.getSelection();
      const container = containerRef.current;
      if (!sel || sel.rangeCount === 0 || !container) return setPending(null);
      const range = sel.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) return setPending(null);
      const anchor = selectionToAnchor(range, contentOf);
      if (!anchor) return setPending(null);
      const rect = range.getBoundingClientRect();
      // Centred above the selection; below it when there is no room above.
      const below = rect.top - TOOLBAR_HEIGHT - 8 < container.getBoundingClientRect().top;
      setPending({ anchor, x: rect.left + rect.width / 2, y: below ? rect.bottom + 8 : rect.top - 8, below });
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [containerRef, contentOf]);

  async function sendToDefinitions() {
    if (!pending) return;
    setBusy(true);
    try {
      const { anchor } = pending;
      const { definition, created } = await api.captureDefinition({
        nodeId,
        messageId: anchor.messageId,
        start: anchor.start,
        end: anchor.end,
        text: anchor.text,
      });
      remember(definition);
      document.getSelection()?.removeAllRanges();
      setPending(null);
      setNotice({ text: created ? `Added “${definition.term}” to Definitions` : `“${definition.term}” is already in Definitions`, id: definition.id });
      setTimeout(() => setNotice(null), 4000);
      void refreshIndex();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't add the term");
    } finally {
      setBusy(false);
    }
  }

  function openForm(action: Action) {
    formOpen.current = true;
    setForm({ action, question: "" });
  }

  /** Ends the toolbar entirely: no form, no pending selection. */
  function close() {
    formOpen.current = false;
    setForm(null);
    setPending(null);
    document.getSelection()?.removeAllRanges();
  }

  async function submit() {
    if (!pending || !form) return;
    const { anchor } = pending;
    const { action, question } = form;
    setBusy(true);
    try {
      if (action === "branch") {
        const { node } = await api.branch(nodeId, anchor);
        // The new branch's composer starts with the typed question, else the anchor (FR-009, FR-010).
        setDraft(node.id, question.trim() ? question : anchor.text);
        close();
        router.push(`/n/${node.id}`);
      } else {
        // Close first: the user stays in the conversation and may select again at once, which a
        // late close() would wipe.
        close();
        await api.park(nodeId, anchor, question);
        setParkedNotice(true);
        setTimeout(() => setParkedNotice(false), 4000);
        onParked();
      }
    } catch (err) {
      const fallback = action === "branch" ? "Couldn't create the branch" : "Couldn't park this";
      onError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {notice && (
        <div className="toast" role="status" data-testid="definitions-notice">
          {notice.text} · <Link href={`/definitions#${notice.id}`}>Open</Link>
        </div>
      )}
      {parkedNotice && (
        <div className="toast" role="status" data-testid="parked-notice">
          Parked ·{" "}
          <button
            type="button"
            className="toast-link"
            onClick={() => {
              setBranchPanelOpen(true);
              setPanelTab("parked");
              setParkedNotice(false);
            }}
          >
            View
          </button>
        </div>
      )}
      {pending && form && (
        <form
          className={`highlight-toolbar highlight-form${pending.below ? " below" : ""}`}
          data-testid="branch-question-form"
          style={{ left: Math.max(170, Math.min(pending.x, window.innerWidth - 170)), top: pending.y }}
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
      {pending && !form && (
        <div
          className={`highlight-toolbar${pending.below ? " below" : ""}`}
          role="toolbar"
          aria-label="Highlight actions"
          style={{ left: Math.max(130, Math.min(pending.x, window.innerWidth - 130)), top: pending.y }}
          // Keep the selection alive while clicking.
          onMouseDown={(e) => e.preventDefault()}
        >
          <button type="button" disabled={busy} onClick={() => void sendToDefinitions()} title="Add this term to Definitions">
            <span aria-hidden="true">📖</span> Define
          </button>
          <button
            type="button"
            disabled={busy}
            title="Start a new branch from this text"
            onClick={() => openForm("branch")}
          >
            <span aria-hidden="true">⑂</span> Branch
          </button>
          <button
            type="button"
            disabled={busy}
            title="Save this text as a tangent for later"
            onClick={() => openForm("park")}
          >
            <span aria-hidden="true">🅿</span> Park
          </button>
        </div>
      )}
    </>
  );
}
