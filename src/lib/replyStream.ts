"use client";

import { useEffect, useState } from "react";
import { Message, type Message as MessageT } from "@/shared/schemas";

/**
 * Follows a streaming reply over Server-Sent Events. Returns the text so far; calls onEnd with
 * the final message when the reply ends (complete, incomplete, stopped or failed).
 */
export function useReplyStream(messageId: string | null, onEnd: (message: MessageT) => void): string {
  const [state, setState] = useState<{ id: string | null; text: string }>({ id: null, text: "" });

  useEffect(() => {
    if (!messageId) return;
    const source = new EventSource(`/api/messages/${messageId}/stream`);
    source.addEventListener("snapshot", (e) => {
      setState({ id: messageId, text: (JSON.parse((e as MessageEvent).data) as { text: string }).text });
    });
    source.addEventListener("delta", (e) => {
      const { text } = JSON.parse((e as MessageEvent).data) as { text: string };
      setState((s) => ({ id: messageId, text: s.id === messageId ? s.text + text : text }));
    });
    source.addEventListener("end", (e) => {
      source.close();
      const parsed = Message.safeParse((JSON.parse((e as MessageEvent).data) as { message: unknown }).message);
      if (parsed.success) onEnd(parsed.data);
    });
    return () => source.close();
    // onEnd is read at event time; resubscribing on every render would restart the stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId]);

  return state.id === messageId ? state.text : "";
}
