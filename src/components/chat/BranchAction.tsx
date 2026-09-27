"use client";

import { useRouter } from "next/navigation";
import { type RefObject, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Anchor } from "@/shared/schemas";
import { selectionToAnchor } from "./selection";

type Props = {
  nodeId: string;
  containerRef: RefObject<HTMLElement | null>;
  contentOf: (messageId: string) => string | undefined;
  onError: (message: string) => void;
};

/** Floating "Branch" button for a valid selection inside one message (FR-002). */
export function BranchAction({ nodeId, containerRef, contentOf, onError }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<{ anchor: Anchor; x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);

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
      setPending({ anchor, x: rect.right, y: rect.bottom + 6 });
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [containerRef, contentOf]);

  if (!pending) return null;
  return (
    <button
      type="button"
      className="btn btn-primary branch-action"
      style={{ left: Math.min(pending.x, window.innerWidth - 100), top: pending.y }}
      disabled={busy}
      // Keep the selection alive while clicking.
      onMouseDown={(e) => e.preventDefault()}
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
      Branch
    </button>
  );
}
