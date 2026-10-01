"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Message } from "@/components/chat/Message";
import { SummaryLabel } from "@/components/chat/NodeHeader";
import { api, ApiError } from "@/lib/api";
import { findKind, getKind } from "@/shared/kinds";
import type { OutputVersion, OutputViewResponse } from "@/shared/schemas";
import { useViewStore } from "@/state/viewStore";
import { NodeSettings } from "./NodeSettings";

const POLL_MS = 4000;
const STATE = { proposed: "Proposed", confirmed: "Confirmed", rejected: "Rejected" } as const;
const noop = () => undefined;

/** "Everyday life · Two or three sentences": the settings a version was made with. */
function settingsLabel(kind: string, settings: Record<string, string>): string {
  return getKind(kind)
    .settings.map((s) => s.choices.find((c) => c.value === settings[s.key])?.label)
    .filter(Boolean)
    .join(" · ");
}

/**
 * A function output beside the node it was made from (Feature 9, view "output_beside_input",
 * FR-019). The output is AI material and is always shown as such; nothing here offers Branch,
 * Define or Park (FR-005). Regenerating and reviewing happen only on the user's click.
 */
export function OutputView({ nodeId }: { nodeId: string }) {
  const [view, setView] = useState<OutputViewResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"regenerate" | "review" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setLastNode = useViewStore((s) => s.setLastNode);

  const load = useCallback(
    () =>
      api.getOutputView(nodeId).then(
        (next) => {
          setView(next);
          setLoadError(null);
        },
        (err: unknown) => setLoadError(err instanceof ApiError && err.status === 404 ? "Not found" : "Couldn't load"),
      ),
    [nodeId],
  );

  useEffect(() => {
    setLastNode(nodeId);
    void load();
    // The input's summary can move on while this is open; the stale badge follows it.
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [nodeId, load, setLastNode]);

  async function act(kind: "regenerate" | "review", run: () => Promise<unknown>) {
    setBusy(kind);
    setError(null);
    try {
      await run();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  if (!view) return <div className="empty-state">{loadError ?? "Loading…"}</div>;

  const { node, versions, input } = view;
  const output = node.output!;
  const label = findKind(node.kind)?.label ?? node.kind;
  const latest: OutputVersion = versions[0];
  const regenerate = () => act("regenerate", () => api.regenerateOutput(nodeId));

  return (
    <section className="output-view" data-testid="output-view">
      <div className="output-panel" data-testid="output-panel">
        <div className={`output-card ${output.review === "confirmed" ? "confirmed" : ""}`}>
          <h1>
            <span className="ai-tag">AI</span> {label}
            <span className={`review-chip review-${output.review}`} data-testid="output-state">
              {STATE[output.review]}
            </span>
          </h1>
          <p className="output-text" data-testid="output-text">
            {output.displayedText}
          </p>
        </div>

        {output.stale && (
          <div className="stale-badge" data-testid="stale-badge">
            Made from an older summary
            <button
              type="button"
              className="btn btn-small"
              data-testid="regenerate-button"
              disabled={busy !== null}
              onClick={() => void regenerate()}
            >
              {busy === "regenerate" ? "Regenerating…" : "Regenerate"}
            </button>
          </div>
        )}

        {output.pendingDraft && (
          <div className="draft-panel" data-testid="draft-panel">
            <strong>New draft</strong> <span className="muted">(AI-suggested, not yet confirmed)</span>
            <p>{latest.text}</p>
            <button
              type="button"
              className="btn btn-small btn-primary"
              data-testid="confirm-draft"
              disabled={busy !== null}
              onClick={() => void act("review", () => api.confirmOutput(nodeId, latest.id))}
            >
              Use this version
            </button>
          </div>
        )}

        <div className="output-actions">
          {output.review !== "confirmed" && (
            <button
              type="button"
              className="btn btn-small btn-primary"
              data-testid="confirm-output"
              disabled={busy !== null}
              onClick={() => void act("review", () => api.confirmOutput(nodeId, latest.id))}
            >
              Confirm
            </button>
          )}
          {output.review !== "rejected" && (
            <button
              type="button"
              className="btn btn-small"
              data-testid="reject-output"
              disabled={busy !== null}
              onClick={() => void act("review", () => api.rejectOutput(nodeId))}
            >
              Reject
            </button>
          )}
        </div>
        {error && (
          <p className="composer-error" role="alert" data-testid="output-error">
            {error}{" "}
            {busy === null && output.stale && (
              <button type="button" className="btn btn-small" onClick={() => void regenerate()}>
                Retry
              </button>
            )}
          </p>
        )}

        <details className="versions-list" data-testid="versions-list">
          <summary>
            {versions.length} {versions.length === 1 ? "version" : "versions"}
          </summary>
          <ol>
            {versions.map((v) => (
              <li key={v.id} data-testid="version-item">
                <div>{v.text}</div>
                <div className="muted">
                  {new Date(v.createdAt).toLocaleString()} · {settingsLabel(node.kind, v.settings)}
                  {v.confirmed ? " · Confirmed" : ""}
                </div>
              </li>
            ))}
          </ol>
        </details>

        <NodeSettings
          nodeId={nodeId}
          kind={node.kind}
          settings={view.settings}
          onSaved={(settings) => setView((v) => (v ? { ...v, settings } : v))}
        />
      </div>

      <div className="input-panel" data-testid="input-panel">
        <h2>Made from</h2>
        <SummaryLabel summary={input.node.summary} />
        <Link href={`/n/${input.node.id}`} data-testid="open-input">
          Open conversation
        </Link>
        <div className="input-conversation" data-testid="input-conversation">
          {input.messages.map((m) => (
            <Message
              key={m.id}
              message={m}
              markers={[]}
              matcher={null}
              underlineBold={false}
              canRegenerate={false}
              busy={false}
              onRetry={noop}
              onRegenerate={noop}
              readOnly
            />
          ))}
        </div>
      </div>
    </section>
  );
}
