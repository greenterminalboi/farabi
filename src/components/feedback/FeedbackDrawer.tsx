"use client";

import { useEffect, useState } from "react";
import { useFeedbackStore } from "@/state/feedbackStore";
import { FeedbackForm } from "./FeedbackForm";
import { FeedbackList } from "./FeedbackList";
import { Lightbox } from "./Lightbox";
import { TagFilter } from "./TagFilter";

/**
 * Overlays whatever view is showing and never changes the route, so opening it never navigates
 * away (FR-002, research R1). Mounted once in the root layout.
 */
export function FeedbackDrawer() {
  const open = useFeedbackStore((s) => s.open);
  const setOpen = useFeedbackStore((s) => s.setOpen);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (lightbox) setLightbox(null);
      else setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, lightbox, setOpen]);

  if (!open) return null;
  return (
    <aside id="feedback-drawer" className="feedback-drawer" aria-label="Feedback">
      <div className="feedback-drawer-head">
        <h2>Feedback</h2>
        <button type="button" className="btn btn-small" onClick={() => setOpen(false)} aria-label="Close feedback">
          ✕
        </button>
      </div>
      <FeedbackForm />
      <TagFilter />
      <FeedbackList onOpenImage={setLightbox} />
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </aside>
  );
}
