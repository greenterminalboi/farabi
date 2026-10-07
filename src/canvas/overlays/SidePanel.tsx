"use client";

// The side panel (FR-022, Feature 8): for the focused element, its direct child edges, newest first,
// and the tangents parked from it. A click on a branch walks there; parked tangents can be fired,
// edited or discarded.
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { Element, PanelResponse, ParkedTangent } from "@/shared/schemas";
import { useSettingsStore } from "@/state/settingsStore";
import { useEngine } from "../engine";
import { useCanvasStore } from "../store";

type Tab = "branches" | "parked";

const STATE_LABEL: Record<string, string> = {
  unsent: "unsent",
  replying: "replying",
  answered: "answered",
  incomplete: "cut off",
  stopped: "stopped",
  failed: "failed",
};

export function SidePanel() {
  const engine = useEngine();
  const focusId = useCanvasStore((s) => s.focusId);
  const revision = useCanvasStore((s) => s.revision);
  const open = useSettingsStore((s) => s.branchPanelOpen);
  const setOpen = useSettingsStore((s) => s.setBranchPanelOpen);
  const [tab, setTab] = useState<Tab>("branches");
  const [data, setData] = useState<{ id: string; panel: PanelResponse } | null>(null);

  const reload = useCallback(async () => {
    if (!focusId) return;
    try {
      setData({ id: focusId, panel: await api.panel(focusId) });
    } catch {
      // The panel is a convenience; the canvas still shows everything.
    }
  }, [focusId]);

  // Follows the focus, and new rows anywhere (a branch or a reply arriving).
  useEffect(() => {
    if (!open || !focusId) return;
    const timer = setTimeout(() => void reload(), 150);
    return () => clearTimeout(timer);
  }, [open, focusId, revision, reload]);

  useEffect(() => {
    const refresh = () => void reload();
    const toTab = (e: Event) => setTab((e as CustomEvent<Tab>).detail);
    window.addEventListener("farabi:panel-refresh", refresh);
    window.addEventListener("farabi:panel-tab", toTab);
    return () => {
      window.removeEventListener("farabi:panel-refresh", refresh);
      window.removeEventListener("farabi:panel-tab", toTab);
    };
  }, [reload]);

  if (!open) {
    return (
      <aside className="branch-panel side-panel collapsed" aria-label="Branch queue" data-testid="branch-panel" data-overlay>
        <button type="button" className="branch-panel-toggle" aria-label="Show branch panel" title="Show branch panel" onClick={() => setOpen(true)}>
          ‹
        </button>
      </aside>
    );
  }
  const panel = focusId && data?.id === focusId ? data.panel : null;
  const children = panel?.children ?? [];
  const parked = panel?.parked ?? [];

  return (
    <aside className="branch-panel side-panel" aria-label="Branch queue" data-testid="branch-panel" data-overlay>
      <div className="branch-panel-head">
        <div role="tablist" aria-label="Branch queue" className="branch-panel-tabs">
          <button type="button" role="tab" id="branch-tab-branches" aria-selected={tab === "branches"} aria-controls="branch-panel-branches" onClick={() => setTab("branches")}>
            Branches <span className="branch-panel-count">{children.length}</span>
          </button>
          <button type="button" role="tab" id="branch-tab-parked" aria-selected={tab === "parked"} aria-controls="branch-panel-parked" onClick={() => setTab("parked")}>
            Parked <span className="branch-panel-count">{parked.length}</span>
          </button>
        </div>
        <button type="button" className="branch-panel-toggle" aria-label="Hide branch panel" title="Hide branch panel" onClick={() => setOpen(false)}>
          ›
        </button>
      </div>
      {tab === "branches" ? (
        <div role="tabpanel" id="branch-panel-branches" aria-labelledby="branch-tab-branches" data-testid="branches-tab">
          {children.length === 0 ? (
            <p className="branch-panel-empty" data-testid="branches-empty">
              {focusId ? "Nothing leaves this yet. Ask below, or select text and choose Branch." : "Click an element to see what leaves it."}
            </p>
          ) : (
            <ul className="branch-panel-list">
              {children.map((child) => (
                <li key={child.id}>
                  <button type="button" className="branch-row" data-testid="branch-row" onClick={() => engine?.walkTo(child.id)}>
                    <BranchRow child={child} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div role="tabpanel" id="branch-panel-parked" aria-labelledby="branch-tab-parked" data-testid="parked-tab">
          <ParkedList key={focusId ?? "none"} parked={parked} reload={reload} />
        </div>
      )}
    </aside>
  );
}

function BranchRow({ child }: { child: Element }) {
  const words = child.kind === "function" ? `${child.functionName ?? "Function"} →` : (child.text ?? "").split(/\s+/).slice(0, 12).join(" ");
  return (
    <>
      <span className="branch-row-title">{words || "Unsent branch"}</span>
      {child.anchor && <span className="branch-row-anchor">“{child.anchor.text}”</span>}
      {child.state && <span className="branch-row-meta">{STATE_LABEL[child.state]}</span>}
    </>
  );
}

function ParkedList({ parked, reload }: { parked: ParkedTangent[]; reload: () => Promise<void> }) {
  // Discarded items hide at once, before the server confirms (Feature 8).
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

function ParkedItem({ item, reload, onHide }: { item: ParkedTangent; reload: () => Promise<void>; onHide: (hide: boolean) => void }) {
  const engine = useEngine();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  function fail(err: unknown, fallback: string) {
    if (isConsumed(err)) void reload();
    else setError(err instanceof Error ? err.message : fallback);
  }

  async function fire() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.fireParked(item.id);
      const store = useCanvasStore.getState();
      if (res.kind === "sent") store.merge([res.edge, res.answer]);
      else {
        store.merge([res.edge]);
        // Without a question the edge opens with the anchor text waiting in the composer (FR-021).
        store.setDraft(res.edge.id, res.draft);
      }
      engine?.walkTo(res.kind === "sent" ? res.answer.id : res.edge.id);
      await reload();
    } catch (err) {
      fail(err, "Couldn't open the branch");
    } finally {
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
        <button type="button" className="btn btn-small btn-primary" disabled={busy || editing !== null} onClick={() => void fire()}>
          {item.question !== null ? "Ask in new branch" : "Open as branch"}
        </button>
        <button type="button" className="btn btn-small" disabled={busy} onClick={() => setEditing(item.question ?? "")}>
          Edit question
        </button>
        <button type="button" className="btn btn-small" disabled={busy} onClick={() => void discard()}>
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
