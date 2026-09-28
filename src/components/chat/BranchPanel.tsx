"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { NodeView, ParkedTangent } from "@/shared/schemas";
import { useSettingsStore } from "@/state/settingsStore";
import { useViewStore } from "@/state/viewStore";

type Props = { view: NodeView; reload: () => Promise<unknown> | void };

/**
 * The branch queue beside the chat (Feature 8): the open node's direct branches, and the tangents
 * parked from it. Both lists come from the node view, so they follow the open node (FR-004).
 */
export function BranchPanel({ view, reload }: Props) {
  const open = useSettingsStore((s) => s.branchPanelOpen);
  const setOpen = useSettingsStore((s) => s.setBranchPanelOpen);
  const tab = useViewStore((s) => s.panelTab);
  const setTab = useViewStore((s) => s.setPanelTab);

  if (!open) {
    return (
      <aside
        className="branch-panel collapsed"
        aria-label="Branch queue"
        data-testid="branch-panel"
      >
        <button
          type="button"
          className="branch-panel-toggle"
          aria-label="Show branch panel"
          title="Show branch panel"
          onClick={() => setOpen(true)}
        >
          ‹
        </button>
      </aside>
    );
  }

  return (
    <aside className="branch-panel" aria-label="Branch queue" data-testid="branch-panel">
      <div className="branch-panel-head">
        <div role="tablist" aria-label="Branch queue" className="branch-panel-tabs">
          <button
            type="button"
            role="tab"
            id="branch-tab-branches"
            aria-selected={tab === "branches"}
            aria-controls="branch-panel-branches"
            onClick={() => setTab("branches")}
          >
            Branches <span className="branch-panel-count">{view.children.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            id="branch-tab-parked"
            aria-selected={tab === "parked"}
            aria-controls="branch-panel-parked"
            onClick={() => setTab("parked")}
          >
            Parked <span className="branch-panel-count">{view.parked.length}</span>
          </button>
        </div>
        <button
          type="button"
          className="branch-panel-toggle"
          aria-label="Hide branch panel"
          title="Hide branch panel"
          onClick={() => setOpen(false)}
        >
          ›
        </button>
      </div>
      {tab === "branches" ? (
        <div
          role="tabpanel"
          id="branch-panel-branches"
          aria-labelledby="branch-tab-branches"
          data-testid="branches-tab"
        >
          <BranchesList view={view} />
        </div>
      ) : (
        <div
          role="tabpanel"
          id="branch-panel-parked"
          aria-labelledby="branch-tab-parked"
          data-testid="parked-tab"
        >
          <ParkedList key={view.node.id} parked={view.parked} reload={reload} />
        </div>
      )}
    </aside>
  );
}

function BranchesList({ view }: { view: NodeView }) {
  if (view.children.length === 0) {
    return (
      <p className="branch-panel-empty" data-testid="branches-empty">
        No branches from this conversation yet. Select text and choose Branch.
      </p>
    );
  }
  return (
    <ul className="branch-panel-list">
      {view.children.map((child) => (
        <li key={child.id}>
          <Link href={`/n/${child.id}`} className="branch-row">
            <span className="branch-row-title">{child.summary.text}</span>
            {child.anchorText && <span className="branch-row-anchor">“{child.anchorText}”</span>}
            <span className="branch-row-meta">
              {child.messageCount} {child.messageCount === 1 ? "message" : "messages"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ParkedList({ parked, reload }: { parked: ParkedTangent[]; reload: Props["reload"] }) {
  // Discarded items hide at once, before the server confirms (contracts/ui.md).
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const shown = parked.filter((p) => !hidden.has(p.id));

  if (shown.length === 0) {
    return (
      <p className="branch-panel-empty" data-testid="parked-empty">
        Nothing parked. Select text and choose Park to save a tangent for later.
      </p>
    );
  }
  return (
    <ul className="branch-panel-list">
      {shown.map((p) => (
        <ParkedItem
          key={p.id}
          item={p}
          reload={reload}
          onHide={(hide) =>
            setHidden((prev) => {
              const next = new Set(prev);
              if (hide) next.add(p.id);
              else next.delete(p.id);
              return next;
            })
          }
        />
      ))}
    </ul>
  );
}

const isConsumed = (err: unknown) => err instanceof ApiError && err.code === "parked_consumed";

function ParkedItem({
  item,
  reload,
  onHide,
}: {
  item: ParkedTangent;
  reload: Props["reload"];
  onHide: (hide: boolean) => void;
}) {
  const router = useRouter();
  const setDraft = useViewStore((s) => s.setDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  // A stale item (used or discarded elsewhere) just disappears on reload.
  function fail(err: unknown, fallback: string) {
    if (isConsumed(err)) void reload();
    else setError(err instanceof Error ? err.message : fallback);
  }

  async function fire() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.fireParked(item.id);
      // Without a question the branch opens with the anchor text waiting in the composer (FR-013).
      if (res.kind === "preload") setDraft(res.node.id, res.draft);
      router.push(`/n/${res.node.id}`);
    } catch (err) {
      fail(err, "Couldn't open the branch");
      setBusy(false);
    }
  }

  async function saveQuestion(value: string) {
    setBusy(true);
    setError(null);
    try {
      await api.setParkedQuestion(item.id, value);
      setEditing(null);
      await reload();
    } catch (err) {
      fail(err, "Couldn't save the question");
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    onHide(true);
    try {
      await api.discardParked(item.id);
      await reload();
    } catch (err) {
      if (isConsumed(err)) return void reload();
      onHide(false);
      setError(err instanceof Error ? err.message : "Couldn't discard");
    }
  }

  return (
    <li className="parked-item" data-testid="parked-item">
      <span className="parked-anchor">“{item.anchor.text}”</span>
      {editing !== null ? (
        <form
          className="parked-edit"
          onSubmit={(e) => {
            e.preventDefault();
            void saveQuestion(editing);
          }}
        >
          <input
            autoFocus
            aria-label="Question"
            value={editing}
            disabled={busy}
            onChange={(e) => setEditing(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setEditing(null);
              }
            }}
          />
        </form>
      ) : item.question !== null ? (
        <span className="parked-question">{item.question}</span>
      ) : (
        <span className="parked-question muted">No question: opens with the highlighted text</span>
      )}
      <div className="parked-actions">
        <button
          type="button"
          className="btn btn-small btn-primary"
          disabled={busy || editing !== null}
          onClick={() => void fire()}
        >
          {item.question !== null ? "Ask in new branch" : "Open as branch"}
        </button>
        <button
          type="button"
          className="btn btn-small"
          disabled={busy}
          onClick={() => setEditing(item.question ?? "")}
        >
          Edit question
        </button>
        <button
          type="button"
          className="btn btn-small"
          disabled={busy}
          onClick={() => void discard()}
        >
          Discard
        </button>
      </div>
      {error && (
        <span className="parked-error" role="alert">
          {error}
        </span>
      )}
    </li>
  );
}
