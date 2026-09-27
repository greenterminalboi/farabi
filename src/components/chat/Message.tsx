"use client";

import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import type { Marker, Message as MessageT } from "@/shared/schemas";
import { splitByMarkers } from "./markerRanges";
import { rehypeSourceOffsets } from "./rehypeSourceOffsets";

type Props = {
  message: MessageT;
  markers: Marker[];
  canRegenerate: boolean;
  busy: boolean;
  onRetry: (messageId: string) => void;
  onRegenerate: (messageId: string) => void;
};

/** User text is shown verbatim, so every character maps straight to its stored offset. */
function PlainText({ content, markers }: { content: string; markers: Marker[] }) {
  return (
    <div className="body" style={{ whiteSpace: "pre-wrap" }}>
      {splitByMarkers(0, content.length, markers).map((seg) => (
        <span
          key={seg.start}
          data-start={seg.start}
          data-end={seg.end}
          className={
            seg.markers.length ? `marker ${seg.markers.length > 1 ? "depth-2" : "depth-1"}` : undefined
          }
          data-markers={seg.markers.length ? seg.markers.map((m) => m.id).join(" ") : undefined}
        >
          {content.slice(seg.start, seg.end)}
        </span>
      ))}
    </div>
  );
}

function MarkdownText({ content, markers }: { content: string; markers: Marker[] }) {
  const rehypePlugins = useMemo(() => [[rehypeSourceOffsets, { markers }] as const], [markers]);
  return (
    <div className="body">
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <ReactMarkdown rehypePlugins={rehypePlugins as any}>{content}</ReactMarkdown>
    </div>
  );
}

function MessageView({ message, markers, canRegenerate, busy, onRetry, onRegenerate }: Props) {
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
      <div className="role">
        {isAi ? <span className="ai-tag">AI</span> : <span>You</span>}
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
      {message.status === "pending" && <div className="typing">Thinking…</div>}
      {message.status === "failed" && (
        <div className="error">
          Couldn&apos;t get a reply.
          <button type="button" className="btn btn-small" disabled={busy} onClick={() => onRetry(message.id)}>
            Retry
          </button>
        </div>
      )}
      {message.status === "complete" &&
        (isAi ? (
          <MarkdownText content={message.content} markers={markers} />
        ) : (
          <PlainText content={message.content} markers={markers} />
        ))}
    </article>
  );
}

export const Message = memo(MessageView);
