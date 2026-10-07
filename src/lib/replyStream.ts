"use client";

import { useEffect, useState } from "react";
import { Element, type Element as ElementT } from "@/shared/schemas";

/**
 * Follows a streaming answer over Server-Sent Events (Feature 2, keyed by answer id in v0.2).
 * Returns the text so far; calls onEnd with the final answer when the reply ends (complete,
 * incomplete, stopped or failed).
 */
export function useReplyStream(answerId: string | null, onEnd: (answer: ElementT) => void): string {
  const [state, setState] = useState<{ id: string | null; text: string }>({ id: null, text: "" });

  useEffect(() => {
    if (!answerId) return;
    return followReply(answerId, (text) => setState({ id: answerId, text }), onEnd);
    // onEnd is read at event time; resubscribing on every render would restart the stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answerId]);

  return state.id === answerId ? state.text : "";
}

/** Imperative form: `onText` gets the whole text so far after each event. Returns a closer. */
export function followReply(answerId: string, onText: (text: string) => void, onEnd: (answer: ElementT) => void): () => void {
  const source = new EventSource(`/api/answers/${answerId}/stream`);
  let text = "";
  source.addEventListener("snapshot", (e) => {
    text = (JSON.parse((e as MessageEvent).data) as { text: string }).text;
    onText(text);
  });
  source.addEventListener("delta", (e) => {
    text += (JSON.parse((e as MessageEvent).data) as { text: string }).text;
    onText(text);
  });
  source.addEventListener("end", (e) => {
    source.close();
    const parsed = Element.safeParse((JSON.parse((e as MessageEvent).data) as { answer: unknown }).answer);
    if (parsed.success) onEnd(parsed.data);
  });
  return () => source.close();
}
