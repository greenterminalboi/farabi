"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { getCachedNode, setCachedNode } from "@/lib/nodeCache";
import type { Marker, NodeView } from "@/shared/schemas";
import { nodeViewState, useViewStore } from "@/state/viewStore";
import { BranchAction } from "./BranchAction";
import { Composer } from "./Composer";
import { InheritedContext } from "./InheritedContext";
import { Message } from "./Message";
import { NodeHeader } from "./NodeHeader";

const SUMMARY_POLL_MS = 4000;
const NO_MARKERS: Marker[] = [];

export function ChatView({ nodeId }: { nodeId: string }) {
  const router = useRouter();
  const [view, setView] = useState<NodeView | null>(() => getCachedNode(nodeId) ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ markers: Marker[]; x: number; y: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoredFor = useRef<string | null>(null);
  const setScroll = useViewStore((s) => s.setScroll);
  const setLastNode = useViewStore((s) => s.setLastNode);

  const load = useCallback(
    () =>
      api.getNode(nodeId).then(
        (next) => {
          setCachedNode(next);
          setView(next);
          setLoadError(null);
        },
        (err: unknown) =>
          setLoadError(
            err instanceof ApiError && err.status === 404 ? "Conversation not found" : "Couldn't load",
          ),
      ),
    [nodeId],
  );

  useEffect(() => {
    setLastNode(nodeId);
    load();
  }, [nodeId, load, setLastNode]);

  // Summaries regenerate in the background; refresh the header label while this node is open.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, SUMMARY_POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Restore where the user left this conversation (FR-022), once per visit.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!view || !list || restoredFor.current === nodeId) return;
    restoredFor.current = nodeId;
    const saved = nodeViewState(nodeId).scrollTop;
    list.scrollTop = saved ?? list.scrollHeight;
  }, [view, nodeId]);

  const contents = useMemo(() => new Map(view?.messages.map((m) => [m.id, m.content])), [view]);
  const contentOf = useCallback((id: string) => contents.get(id), [contents]);
  const markersByMessage = useMemo(() => {
    const map = new Map<string, Marker[]>();
    for (const m of view?.markers ?? []) map.set(m.messageId, [...(map.get(m.messageId) ?? []), m]);
    return map;
  }, [view]);

  const scrollToBottom = () =>
    requestAnimationFrame(() => {
      const list = listRef.current;
      if (list) list.scrollTop = list.scrollHeight;
    });

  async function send(content: string): Promise<"stored" | "not_stored"> {
    setError(null);
    setBusy(true);
    // Optimistic: show the user's message and a pending reply right away.
    setView((v) =>
      v && {
        ...v,
        canRegenerate: null,
        messages: [
          ...v.messages,
          { id: "optimistic-user", seq: -1, role: "user", content, status: "complete", provenance: "user_authored", createdAt: "" },
          { id: "optimistic-ai", seq: -1, role: "ai", content: "", status: "pending", provenance: "ai_suggested", createdAt: "" },
        ],
      },
    );
    scrollToBottom();
    try {
      await api.sendMessage(nodeId, content);
      return "stored";
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setError("AI service unavailable. Your message was saved. Use Retry on the reply.");
        return "stored";
      }
      setError(err instanceof ApiError ? err.message : "Couldn't send. Your text is kept below.");
      return "not_stored";
    } finally {
      setBusy(false);
      await load();
      scrollToBottom();
    }
  }

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 503
          ? "AI service unavailable. Try again."
          : err instanceof Error
            ? err.message
            : "Something went wrong",
      );
    } finally {
      setBusy(false);
      await load();
    }
  }

  function onListClick(e: React.MouseEvent) {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-markers]");
    if (!target || !view) return;
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed) return; // the user is selecting, not clicking a marker
    const ids = target.dataset.markers!.split(" ");
    const markers = view.markers.filter((m) => ids.includes(m.id));
    if (markers.length === 1) router.push(`/n/${markers[0].childNodeId}`);
    else setMenu({ markers, x: e.clientX, y: e.clientY });
  }

  if (loadError && !view) return <div className="empty-state">{loadError}</div>;
  if (!view) return <div className="empty-state">Loading…</div>;

  const hasPending = view.messages.some((m) => m.status === "pending");
  return (
    <section className="chat" data-node-id={nodeId}>
      <NodeHeader summary={view.node.summary} />
      {view.anchor && view.node.parentId && (
        <InheritedContext anchor={view.anchor} parentId={view.node.parentId} inherited={view.inheritedContext} />
      )}
      <div
        className="message-list"
        ref={listRef}
        data-testid="message-list"
        onScroll={(e) => setScroll(nodeId, e.currentTarget.scrollTop)}
        onClick={onListClick}
      >
        {view.messages.length === 0 && (
          <p className="typing">
            {view.anchor ? "Ask about the highlighted text to start this branch." : "Start the conversation."}
          </p>
        )}
        {view.messages.map((m) => (
          <Message
            key={m.id}
            message={m}
            markers={markersByMessage.get(m.id) ?? NO_MARKERS}
            canRegenerate={view.canRegenerate?.messageId === m.id}
            busy={busy}
            onRetry={(id) => act(() => api.retry(id))}
            onRegenerate={(id) => act(() => api.regenerate(id))}
          />
        ))}
      </div>
      <BranchAction nodeId={nodeId} containerRef={listRef} contentOf={contentOf} onError={setError} />
      {menu && (
        <div className="marker-menu" style={{ left: menu.x, top: menu.y }} onMouseLeave={() => setMenu(null)}>
          {menu.markers.map((m) => (
            <button key={m.id} type="button" onClick={() => router.push(`/n/${m.childNodeId}`)}>
              Branch: “{m.anchorText}”
            </button>
          ))}
        </div>
      )}
      <Composer nodeId={nodeId} disabled={busy || hasPending} error={error} onSend={send} />
    </section>
  );
}
