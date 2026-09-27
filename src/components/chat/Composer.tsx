"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useViewStore } from "@/state/viewStore";

type Props = {
  nodeId: string;
  disabled: boolean;
  /** A reply is streaming: show Stop instead of Send (FR-003a). */
  streaming: boolean;
  onStop: () => void;
  /** Typing exactly "????" branches at once, without Send, when a quick branch is possible. */
  canQuickBranch: boolean;
  error: string | null;
  onSend: (content: string) => Promise<"stored" | "not_stored">;
};

export function Composer({ nodeId, disabled, streaming, onStop, canQuickBranch, error, onSend }: Props) {
  const draft = useViewStore((s) => s.byNode[nodeId]?.draft ?? "");
  const setDraft = useViewStore((s) => s.setDraft);
  const [sending, setSending] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  // The box grows with its text (Shift+Enter adds a line), up to its max height; only then scrolls.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.style.height = "auto";
    const max = parseFloat(getComputedStyle(box).maxHeight) || Infinity;
    box.style.height = `${Math.min(box.scrollHeight + 2, max)}px`;
    box.classList.toggle("overflowing", box.scrollHeight + 2 > max);
  }, [draft]);

  async function submit() {
    const content = draft;
    if (!content.trim() || sending || disabled || streaming) return;
    setSending(true);
    try {
      // Clear only once the server has stored the message (FR-032: unsent text is never lost).
      if ((await onSend(content)) === "stored") setDraft(nodeId, "");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {error && (
        <div className="composer-error" role="alert">
          {error}
        </div>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          ref={boxRef}
          rows={1}
          aria-label="Message"
          value={draft}
          placeholder="Write a message…"
          onChange={(e) => {
            const value = e.target.value;
            setDraft(nodeId, value);
            // "????" triggers the quick branch the moment it's typed (FR-006).
            if (value.trim() === "????" && canQuickBranch && !sending) {
              setSending(true);
              setDraft(nodeId, "");
              void onSend(value)
                .then((result) => result === "not_stored" && setDraft(nodeId, value))
                .finally(() => setSending(false));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        {streaming ? (
          <button type="button" className="btn" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={sending || disabled || !draft.trim()}>
            Send
          </button>
        )}
      </form>
    </>
  );
}
