"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { getCachedNode, setCachedNode } from "@/lib/nodeCache";
import { useReplyStream } from "@/lib/replyStream";
import type { Marker, NodeView, SuggestedSpan } from "@/shared/schemas";
import { useDefinitionsStore } from "@/state/definitionsStore";
import { useSettingsStore } from "@/state/settingsStore";
import { nodeViewState, useViewStore } from "@/state/viewStore";
import { TermCard } from "@/components/definitions/TermCard";
import { BranchAction } from "./BranchAction";
import { BranchPanel } from "./BranchPanel";
import { Composer } from "./Composer";
import { InheritedContext } from "./InheritedContext";
import { Message } from "./Message";
import { NodeHeader } from "./NodeHeader";
import { rangeForOffsets } from "./selection";

const SUMMARY_POLL_MS = 4000;
const NO_MARKERS: Marker[] = [];
const NO_SUGGESTIONS: SuggestedSpan[] = [];
/** Requests per round of suggestions while messages are still being analyzed (research R4). */
const SUGGESTION_ROUNDS = 6;

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
  const matcher = useDefinitionsStore((s) => s.matcher);
  const refreshIndex = useDefinitionsStore((s) => s.refreshIndex);
  const sectionRef = useRef<HTMLElement>(null);
  const showSuggestions = useSettingsStore((s) => s.showSuggestions);
  const setShowSuggestions = useSettingsStore((s) => s.setShowSuggestions);
  // Suggested spans per message for the open node; never part of the node's data (Feature 5).
  const [suggestions, setSuggestions] = useState<{ nodeId: string; byMessage: Record<string, SuggestedSpan[]> }>(
    { nodeId, byMessage: {} },
  );
  // Messages already asked about for this node, and whether a round is in flight.
  const suggestTracker = useRef<{ nodeId: string; asked: Set<string>; busy: boolean }>({
    nodeId,
    asked: new Set(),
    busy: false,
  });

  // Read the per-browser setting once mounted (research R8).
  useEffect(() => {
    void useSettingsStore.persist.rehydrate();
  }, []);

  // Load the collected terms once per conversation, so they're underlined (FR-036a).
  useEffect(() => {
    void refreshIndex();
  }, [nodeId, refreshIndex]);

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

  // Ask for suggestions whenever a complete AI reply appears that hasn't been asked about, and keep
  // asking while the server is still analyzing (Feature 5, research R4). Nothing while turned off.
  useEffect(() => {
    // getState() too: on the first render the stored setting may have only just been rehydrated.
    if (!view || !showSuggestions || !useSettingsStore.getState().showSuggestions) return;
    const tracker = suggestTracker.current;
    if (tracker.nodeId !== nodeId) suggestTracker.current = { nodeId, asked: new Set(), busy: false };
    const t = suggestTracker.current;
    const wanted = view.messages.filter((m) => m.role === "ai" && m.status === "complete" && !t.asked.has(m.id));
    if (wanted.length === 0 || t.busy) return;
    t.busy = true;
    void (async () => {
      try {
        for (let round = 0; round < SUGGESTION_ROUNDS && suggestTracker.current === t; round++) {
          const res = await api.getSuggestions(nodeId);
          setSuggestions((prev) =>
            prev.nodeId === nodeId
              ? { nodeId, byMessage: { ...prev.byMessage, ...res.byMessage } }
              : { nodeId, byMessage: res.byMessage },
          );
          if (res.pending.length === 0) break;
        }
      } catch {
        // Suggestions are optional; the conversation works the same without them.
      } finally {
        for (const m of wanted) t.asked.add(m.id);
        t.busy = false;
      }
    })();
  }, [view, nodeId, showSuggestions]);
  const suggestionsOf = (messageId: string) =>
    showSuggestions && suggestions.nodeId === nodeId ? (suggestions.byMessage[messageId] ?? NO_SUGGESTIONS) : NO_SUGGESTIONS;

  const scrollToBottom = () =>
    requestAnimationFrame(() => {
      const list = listRef.current;
      if (list) list.scrollTop = list.scrollHeight;
    });

  // The reply currently streaming in this conversation, if any (Feature 2, FR-001).
  const pending = view?.messages.find((m) => m.role === "ai" && m.status === "pending") ?? null;
  const streamText = useReplyStream(pending?.id ?? null, () => void load());
  // A reply that failed before any text means the AI service couldn't be reached (FR-032).
  const lastFailed = view?.messages.at(-1)?.status === "failed";
  // A quick branch needs a completed message of the user's that hasn't anchored one yet (FR-012).
  const lastUser = view ? [...view.messages].reverse().find((m) => m.role === "user" && m.status === "complete") : undefined;
  const canQuickBranch =
    !!lastUser && !view?.markers.some((m) => m.kind === "whole_message" && m.messageId === lastUser.id);
  const shownError =
    error ?? (lastFailed ? "AI service unavailable. Your message was saved. Use Retry on the reply." : null);

  // Keep the newest text in view while it streams, if the user is already near the bottom.
  useEffect(() => {
    const list = listRef.current;
    if (!list || !streamText) return;
    if (list.scrollHeight - list.scrollTop - list.clientHeight < 120) list.scrollTop = list.scrollHeight;
  }, [streamText]);

  async function send(content: string): Promise<"stored" | "not_stored"> {
    setError(null);
    setBusy(true);
    try {
      const res = await api.sendMessage(nodeId, content);
      if (res.kind === "quick_branch") {
        // "????" branched from the user's last message (FR-010).
        router.push(`/n/${res.node.id}`);
        return "stored";
      }
      await load();
      scrollToBottom();
      return "stored";
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send. Your text is kept below.");
      return "not_stored";
    } finally {
      setBusy(false);
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
    const el = e.target as HTMLElement;
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed) return; // the user is selecting, not clicking
    const target = el.closest<HTMLElement>("[data-markers]");
    if (target && view) {
      const ids = target.dataset.markers!.split(" ");
      const markers = view.markers.filter((m) => ids.includes(m.id));
      if (markers.length === 1) router.push(`/n/${markers[0].childNodeId}`);
      else setMenu({ markers, x: e.clientX, y: e.clientY });
      return;
    }
    // A collected term keeps its own card (Feature 2); it never selects a suggestion.
    if (el.closest(".term-mark")) return;
    // A suggested span becomes the selection, exactly as if dragged over; the highlighter
    // toolbar takes it from there (Feature 5, FR-004, FR-005).
    const suggestion = el.closest<HTMLElement>("[data-suggest]");
    const messageEl = suggestion?.closest<HTMLElement>("[data-message-id]");
    if (!suggestion || !messageEl || !sel) return;
    const [start, end] = suggestion.dataset.suggest!.split("-").map(Number);
    const range = rangeForOffsets(messageEl, start, end);
    if (!range) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  if (loadError && !view) return <div className="empty-state">{loadError}</div>;
  if (!view) return <div className="empty-state">Loading…</div>;

  // The branch panel sits beside the chat in the main row (Feature 8, FR-001).
  return (
    <>
    <section className="chat" data-node-id={nodeId} ref={sectionRef}>
      <NodeHeader
        summary={view.node.summary}
        showSuggestions={showSuggestions}
        onToggleSuggestions={() => setShowSuggestions(!showSuggestions)}
      />
      {view.anchor && view.node.parentId && (
        <InheritedContext
          anchor={view.anchor}
          parentId={view.node.parentId}
          inherited={view.inheritedContext}
          matcher={matcher}
        />
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
            matcher={matcher}
            suggestions={suggestionsOf(m.id)}
            canRegenerate={view.canRegenerate?.messageId === m.id}
            streamText={m.id === pending?.id ? streamText : undefined}
            busy={busy}
            onRetry={(id) => act(() => api.retry(id))}
            onRegenerate={(id) => act(() => api.regenerate(id))}
          />
        ))}
      </div>
      <BranchAction
        nodeId={nodeId}
        containerRef={listRef}
        contentOf={contentOf}
        onError={setError}
        onParked={() => void load()}
      />
      <TermCard containerRef={sectionRef} />
      {menu && (
        <div className="marker-menu" style={{ left: menu.x, top: menu.y }} onMouseLeave={() => setMenu(null)}>
          {menu.markers.map((m) => (
            <button key={m.id} type="button" onClick={() => router.push(`/n/${m.childNodeId}`)}>
              Branch: “{m.anchorText}”
            </button>
          ))}
        </div>
      )}
      <Composer
        canQuickBranch={canQuickBranch}
        nodeId={nodeId}
        disabled={busy}
        streaming={pending !== null}
        onStop={() => pending && act(() => api.stop(pending.id))}
        error={shownError}
        onSend={send}
      />
    </section>
    <BranchPanel view={view} reload={load} />
    </>
  );
}
