"use client";

import { useState } from "react";
import { useViewStore } from "@/state/viewStore";

type Props = {
  nodeId: string;
  disabled: boolean;
  error: string | null;
  onSend: (content: string) => Promise<"stored" | "not_stored">;
};

export function Composer({ nodeId, disabled, error, onSend }: Props) {
  const draft = useViewStore((s) => s.byNode[nodeId]?.draft ?? "");
  const setDraft = useViewStore((s) => s.setDraft);
  const [sending, setSending] = useState(false);

  async function submit() {
    const content = draft;
    if (!content.trim() || sending || disabled) return;
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
          aria-label="Message"
          value={draft}
          placeholder="Write a message…"
          onChange={(e) => setDraft(nodeId, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <button type="submit" className="btn btn-primary" disabled={sending || disabled || !draft.trim()}>
          Send
        </button>
      </form>
    </>
  );
}
