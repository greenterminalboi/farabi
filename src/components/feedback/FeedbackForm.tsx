"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { feedbackContext } from "@/lib/feedbackContext";
import { useFeedbackStore } from "@/state/feedbackStore";

const imageFiles = (list: FileList | null | undefined) =>
  [...(list ?? [])].filter((f) => f.type.startsWith("image/"));

/** Text (required), freeform tags and pasted or dropped screenshots (FR-003 – FR-006). */
export function FeedbackForm() {
  const pathname = usePathname();
  const draft = useFeedbackStore((s) => s.draft);
  const draftError = useFeedbackStore((s) => s.draftError);
  const { setText, addTag, removeTag, addImages, removeImage, submit } = useFeedbackStore.getState();
  const [tagInput, setTagInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const canSubmit = draft.text.trim().length > 0 && !busy;

  const doSubmit = async () => {
    if (!canSubmit) return;
    if (tagInput.trim()) {
      addTag(tagInput);
      setTagInput("");
    }
    setBusy(true);
    try {
      await submit(feedbackContext(pathname));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={`feedback-form${dragOver ? " drag-over" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        void doSubmit();
      }}
      onPaste={(e) => {
        const files = imageFiles(e.clipboardData?.files);
        if (files.length) {
          e.preventDefault();
          void addImages(files);
        }
      }}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        const files = imageFiles(e.dataTransfer.files);
        setDragOver(false);
        if (files.length) {
          e.preventDefault();
          void addImages(files);
        }
      }}
    >
      <textarea
        aria-label="Feedback text"
        placeholder="What did you notice? Paste or drop screenshots here."
        value={draft.text}
        autoFocus
        rows={4}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void doSubmit();
          }
        }}
      />
      {draft.images.length > 0 && (
        <ul className="feedback-previews" aria-label="Screenshots to attach">
          {draft.images.map((img) => (
            <li key={img.id}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
              <img src={img.previewUrl} alt={img.file.name || "Screenshot"} data-testid="feedback-preview" />
              <button type="button" className="btn btn-small" aria-label="Remove screenshot" onClick={() => removeImage(img.id)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="feedback-tags-input">
        {draft.tags.map((t) => (
          <span key={t} className="feedback-tag">
            {t}
            <button type="button" aria-label={`Remove tag ${t}`} onClick={() => removeTag(t)}>
              ×
            </button>
          </span>
        ))}
        <input
          aria-label="Add tag"
          placeholder="Add tag…"
          value={tagInput}
          onChange={(e) => {
            const value = e.target.value;
            if (value.endsWith(",")) {
              addTag(value.slice(0, -1));
              setTagInput("");
            } else setTagInput(value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag(tagInput);
              setTagInput("");
            } else if (e.key === "Backspace" && !tagInput && draft.tags.length) {
              removeTag(draft.tags[draft.tags.length - 1]);
            }
          }}
        />
      </div>
      {draftError && (
        <p className="feedback-error" role="alert">
          {draftError}
        </p>
      )}
      <div className="feedback-form-actions">
        <span className="feedback-hint">⌘↵ to submit</span>
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
          Submit feedback
        </button>
      </div>
    </form>
  );
}
