"use client";

import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { findTerms, type TermMatcher } from "@/lib/terms";
import type { Marker, Message as MessageT, SuggestedSpan } from "@/shared/schemas";
import { segmentAttributes, splitByMarkers } from "./markerRanges";
import { rehypeSourceOffsets } from "./rehypeSourceOffsets";

type Props = {
  message: MessageT;
  markers: Marker[];
  /** Collected terms to underline (Feature 2, FR-036a). */
  matcher: TermMatcher | null;
  /** Suggested places to branch; drawn only on a complete AI reply (Feature 5, FR-003). */
  suggestions: SuggestedSpan[];
  canRegenerate: boolean;
  /** Text so far while this reply streams. */
  streamText?: string;
  busy: boolean;
  onRetry: (messageId: string) => void;
  onRegenerate: (messageId: string) => void;
};

/** User text is shown verbatim, so every character maps straight to its stored offset. */
function PlainText({
  content,
  markers,
  matcher,
}: {
  content: string;
  markers: Marker[];
  matcher: TermMatcher | null;
}) {
  const segments = splitByMarkers(0, content.length, markers, findTerms(content, 0, matcher));
  return (
    <div className="body" style={{ whiteSpace: "pre-wrap" }}>
      {segments.map((seg) => {
        const attrs = segmentAttributes(seg);
        return (
          <span
            key={seg.start}
            data-start={seg.start}
            data-end={seg.end}
            className={attrs.className}
            data-markers={attrs.markers}
            data-def-id={attrs.defId}
          >
            {content.slice(seg.start, seg.end)}
          </span>
        );
      })}
    </div>
  );
}

function MarkdownText({
  content,
  markers,
  matcher = null,
  suggestions,
}: {
  content: string;
  markers: Marker[];
  matcher?: TermMatcher | null;
  suggestions?: SuggestedSpan[];
}) {
  const rehypePlugins = useMemo(
    () => [[rehypeSourceOffsets, { markers, matcher, suggestions }] as const],
    [markers, matcher, suggestions],
  );
  return (
    <div className="body">
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <ReactMarkdown rehypePlugins={rehypePlugins as any}>{content}</ReactMarkdown>
    </div>
  );
}

const ENDED_LABEL: Partial<Record<MessageT["status"], string>> = {
  incomplete: "Incomplete: the reply was cut off.",
  stopped: "Stopped.",
};

function MessageView({
  message,
  markers,
  matcher,
  suggestions,
  canRegenerate,
  streamText,
  busy,
  onRetry,
  onRegenerate,
}: Props) {
  const isAi = message.role === "ai";
  const branchable = message.status === "complete";
  return (
    <article
      className={`message ${message.status === "failed" ? "failed" : ""}`}
      data-role={message.role}
      // Only complete messages can anchor a branch (FR-002).
      data-message-id={branchable ? message.id : undefined}
      data-testid="message"
    >
      {(isAi || canRegenerate) && (
        <div className="role">
          {isAi && <span className="ai-tag">AI</span>}
          {canRegenerate && (
            <button
              type="button"
              className="btn btn-small"
              disabled={busy}
              onClick={() => onRegenerate(message.id)}
            >
              Regenerate
            </button>
          )}
        </div>
      )}
      {message.status === "pending" &&
        (streamText ? (
          // Markdown is rendered as it arrives, not only when the reply ends.
          <div className="body streaming" data-testid="streaming">
            <ReactMarkdown>{streamText}</ReactMarkdown>
          </div>
        ) : (
          <div className="typing">Thinking…</div>
        ))}
      {(message.status === "incomplete" || message.status === "stopped") && (
        <>
          {message.content && <MarkdownText content={message.content} markers={markers} />}
          <div className="error" data-testid="ended-early">
            {ENDED_LABEL[message.status]}
            <button
              type="button"
              className="btn btn-small"
              disabled={busy}
              onClick={() => onRetry(message.id)}
            >
              Retry
            </button>
          </div>
        </>
      )}
      {message.status === "failed" && (
        <div className="error">
          Couldn&apos;t get a reply.
          <button
            type="button"
            className="btn btn-small"
            disabled={busy}
            onClick={() => onRetry(message.id)}
          >
            Retry
          </button>
        </div>
      )}
      {message.status === "complete" &&
        (isAi ? (
          <MarkdownText content={message.content} markers={markers} matcher={matcher} suggestions={suggestions} />
        ) : (
          <PlainText content={message.content} markers={markers} matcher={matcher} />
        ))}
    </article>
  );
}

export const Message = memo(MessageView);
