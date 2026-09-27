"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type RefObject, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Anchor } from "@/shared/schemas";
import { useDefinitionsStore } from "@/state/definitionsStore";
import { selectionToAnchor } from "./selection";

type Props = {
  nodeId: string;
  containerRef: RefObject<HTMLElement | null>;
  contentOf: (messageId: string) => string | undefined;
  onError: (message: string) => void;
};

const TOOLBAR_HEIGHT = 44;

/**
 * The highlighter toolbar: appears over a valid selection inside one message with its actions,
 * Define (send the term to Definitions) and Branch (FR-002).
 */
export function BranchAction({ nodeId, containerRef, contentOf, onError }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<{ anchor: Anchor; x: number; y: number; below: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; id: string } | null>(null);
  const refreshIndex = useDefinitionsStore((s) => s.refreshIndex);
  const remember = useDefinitionsStore((s) => s.remember);

  useEffect(() => {
    const update = () => {
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

  return (
    <>
      {notice && (
        <div className="toast" role="status" data-testid="definitions-notice">
          {notice.text} · <Link href={`/definitions#${notice.id}`}>Open</Link>
        </div>
      )}
      {pending && (
        <div
          className={`highlight-toolbar${pending.below ? " below" : ""}`}
          role="toolbar"
          aria-label="Highlight actions"
          style={{ left: Math.max(90, Math.min(pending.x, window.innerWidth - 90)), top: pending.y }}
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
            onClick={async () => {
              setBusy(true);
              try {
                const { node } = await api.branch(nodeId, pending.anchor);
                document.getSelection()?.removeAllRanges();
                setPending(null);
                router.push(`/n/${node.id}`);
              } catch (err) {
                onError(err instanceof Error ? err.message : "Couldn't create the branch");
              } finally {
                setBusy(false);
              }
            }}
          >
            <span aria-hidden="true">⑂</span> Branch
          </button>
        </div>
      )}
    </>
  );
}
