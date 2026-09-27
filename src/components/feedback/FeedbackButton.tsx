"use client";

import { useEffect } from "react";
import { useFeedbackStore } from "@/state/feedbackStore";

/** Always in the top bar, so feedback is one click away from every view (FR-001, SC-001). */
export function FeedbackButton() {
  const open = useFeedbackStore((s) => s.open);
  const setOpen = useFeedbackStore((s) => s.setOpen);
  const loaded = useFeedbackStore((s) => s.loaded);
  const load = useFeedbackStore((s) => s.load);
  const openCount = useFeedbackStore((s) => s.items.filter((i) => i.state === "open").length);
  const awaiting = useFeedbackStore((s) => s.items.filter((i) => i.state === "addressed").length);

  useEffect(() => {
    if (!loaded) load().catch(() => {});
  }, [loaded, load]);

  return (
    <button
      type="button"
      className="btn feedback-button"
      aria-expanded={open}
      aria-controls="feedback-drawer"
      onClick={() => setOpen(!open)}
    >
      Feedback
      {openCount > 0 && (
        <span className="feedback-count" title={`${openCount} open`}>
          {openCount}
        </span>
      )}
      {awaiting > 0 && (
        <span className="feedback-count feedback-count-ai" title={`${awaiting} waiting for your confirmation`}>
          {awaiting} to confirm
        </span>
      )}
    </button>
  );
}
