// From canvas data to what the two layers draw: the renderer's frames and connectors, and the text
// layer's items (with their frame labels and buttons). Pure, so the host only orchestrates.
import { modelLabel } from "@/shared/models";
import { bandOf } from "@/shared/pressure";
import type { EdgeState, Element } from "@/shared/schemas";
import { CHIP, displayOf, isMarkdown, textOf, widthOf } from "./geometry";
import { type CanvasGraph, children, firstChild } from "./graph";
import type { ForestLayout } from "./layout/forestLayout";
import type { DrawElement } from "./renderer/CanvasRenderer";
import type { ChromePart, TextItem } from "./text/TextLayer";
import { type DecorationInput, decorationKey, makeDecorate } from "./text/decorate";
import type { TermMatcher } from "@/lib/terms";

export type SceneInput = {
  graph: CanvasGraph;
  elements: Iterable<Element>;
  layout: ForestLayout;
  visible: (el: Element) => boolean;
  height: (el: Element) => number;
  /** Text of answers still streaming, newer than the store's checkpoint. */
  streaming: ReadonlyMap<string, string>;
  focusId: string | null;
  /** Temporary positions while dragging. */
  dragOverride: ReadonlyMap<string, { x: number; y: number }>;
  /** Collected terms to underline, and a number that changes with them. */
  terms: { matcher: TermMatcher | null; version: number };
  showSuggestions: boolean;
};

/** An element's decorations: branch markers from its anchored child edges, terms, suggestions. */
function decorationsOf(el: Element, input: SceneInput, text: string): DecorationInput {
  const markers = children(input.graph, el.id)
    .filter((c) => c.anchor && input.visible(c))
    .map((c) => ({ id: c.id, start: c.anchor!.start, end: c.anchor!.end }));
  return {
    markers,
    matcher: text ? input.terms.matcher : null,
    suggestBold: input.showSuggestions && el.kind === "answer" && el.status === "complete",
  };
}

export type BuiltScene = { draw: DrawElement[]; items: TextItem[] };

/** An edge's state from its newest attempt (research R5), recomputed as answers stream in. */
export function edgeStateOf(edge: Element, graph: CanvasGraph): EdgeState {
  if (edge.text === null) return "unsent";
  let newest: Element | undefined;
  for (const c of children(graph, edge.id)) if (c.kind === "answer") newest = c; // creation order
  const status = newest?.status;
  if (status === "pending") return "replying";
  if (status === "complete") return "answered";
  return status ?? "failed";
}

const STATUS_LABEL: Record<string, string> = {
  pending: "writing",
  incomplete: "cut off",
  stopped: "stopped",
  failed: "failed",
};

/** Frame labels and buttons for an element (contracts/canvas-ui.md "Elements as drawn"). */
export function chromeOf(el: Element, state: EdgeState | null, attempt: { n: number; of: number } | null = null): {
  label: string;
  header?: ChromePart[];
  footer?: ChromePart[];
  placeholder?: string;
} {
  switch (displayOf(el)) {
    case "question": {
      const label = `Your message${state && state !== "answered" ? `, ${state}` : ""}`;
      if (el.text === null) return { label, placeholder: "Unsent: ask about the highlighted text below" };
      return { label };
    }
    case "answer": {
      const header: ChromePart[] = [{ text: "AI", className: "ai-tag" }];
      if (el.status && el.status !== "complete") {
        header.push({ text: STATUS_LABEL[el.status], className: `status status-${el.status}`, testid: el.status === "pending" ? "streaming" : undefined });
      }
      // Attempts are siblings side by side (FR-041): each says which one it is.
      if (attempt && attempt.of > 1) header.push({ text: `attempt ${attempt.n} of ${attempt.of}`, className: "status attempt", testid: "attempt" });
      // The settings this reply was written with (Feature 6, FR-057).
      if (el.pressureLevel != null) {
        header.push({
          text: `${bandOf(el.pressureLevel)} · ${el.pressureLevel} · ${modelLabel(el.replyModel ?? null)}`,
          className: "reply-meta",
          testid: "reply-meta",
          title: "Settings when this reply was written",
        });
      }
      if (el.status === "pending") header.push({ action: "stop", label: "Stop", className: "chrome-right" });
      if (el.status === "complete") {
        header.push({ action: "functions", label: "ƒ", title: "Run a function", className: "chrome-right" });
        header.push({ action: "regenerate", label: "↻", title: "Regenerate" });
      }
      const footer: ChromePart[] | undefined =
        el.status === "incomplete" || el.status === "stopped" || el.status === "failed"
          ? [
              { text: el.status === "failed" ? "The reply failed." : el.status === "stopped" ? "Stopped." : "The reply was cut off." },
              { action: "retry", label: "Retry" },
            ]
          : undefined;
      return {
        label: `AI answer${el.status && el.status !== "complete" ? `, ${STATUS_LABEL[el.status]}` : ""}`,
        header,
        footer,
        placeholder: el.status === "pending" ? "Thinking…" : undefined,
      };
    }
    case "output": {
      const header: ChromePart[] = [
        { text: "AI", className: "ai-tag" },
        { text: el.functionName ?? el.kind, className: "status" },
        { text: el.review ?? "proposed", className: `review review-${el.review ?? "proposed"}` },
      ];
      if (el.review !== "confirmed") header.push({ action: "confirm", label: "Confirm", className: "chrome-right" });
      if (el.review !== "rejected") header.push({ action: "reject", label: "Reject", className: el.review === "confirmed" ? "chrome-right" : undefined });
      header.push({ action: "rerun", label: "Run again" });
      return { label: `AI ${el.functionName ?? el.kind}, ${el.review ?? "proposed"}`, header };
    }
    case "drill":
      // A card that opens its own screen (Feature 12). It is the user's, so it has no AI tag.
      return {
        label: `Drill${el.card ? `: ${el.card.title}` : ""}`,
        header: [
          { text: "Drill", className: "status" },
          ...(el.card ? [{ action: "open-card", label: "Open", className: "chrome-right", testid: "card-open" }] : []),
        ],
      };
    case "function_connector":
      return {
        label: `${el.functionName ?? "Function"} applied`,
        header: [
          { text: `${el.functionName ?? "Function"} →`, className: "chip-label" },
          { action: "edge-settings", label: "⚙", title: "Settings for this run" },
        ],
      };
  }
}

const versions = new Map<string, { key: string; version: number }>();

/** A number that changes whenever an item's text or chrome does, so the text layer re-renders it. */
function versionOf(id: string, key: string): number {
  const hit = versions.get(id);
  if (hit && hit.key === key) return hit.version;
  const version = (hit?.version ?? 0) + 1;
  versions.set(id, { key, version });
  return version;
}

export function buildScene(input: SceneInput): BuiltScene {
  const { graph, layout } = input;
  const draw: DrawElement[] = [];
  const items: TextItem[] = [];
  const elements = [...input.elements]; // walked twice: elements, then their notes
  for (const el of elements) {
    if (!input.visible(el)) continue;
    const pos = input.dragOverride.get(el.id) ?? layout.positions.get(el.id);
    if (!pos) continue;
    const display = displayOf(el);
    const streamed = el.status === "pending" ? input.streaming.get(el.id) : undefined;
    const shown: Element = streamed !== undefined ? { ...el, partialText: streamed } : el;
    const h = input.height(shown);
    const w = display === "function_connector" ? CHIP.w : widthOf(el);
    const parent = el.parentId ? graph.graph.hasNode(el.parentId) : false;
    const column = parent ? firstChild(graph, el.parentId!, input.visible)?.id === el.id : false;
    const parentText = el.parentId && el.anchor ? graph.graph.getNodeAttribute(el.parentId, "element").text : null;
    const state = el.kind === "question" ? edgeStateOf(el, graph) : null;
    draw.push({
      id: el.id,
      treeId: el.treeId,
      parentId: el.parentId,
      display,
      box: { x: pos.x, y: pos.y, w, h },
      column,
      anchorAt: el.anchor && parentText ? el.anchor.start / Math.max(1, parentText.length) : null,
      origin: el.parentId === null,
      unsent: el.kind === "question" && el.text === null,
      status: el.status ?? null,
      review: el.review ?? null,
    });

    let attempt: { n: number; of: number } | null = null;
    if (el.kind === "answer" && el.parentId) {
      const tries = children(graph, el.parentId).filter((c) => c.kind === "answer");
      attempt = { n: tries.findIndex((c) => c.id === el.id) + 1, of: tries.length };
    }
    const chrome = chromeOf(el, state, attempt);
    const source = textOf(shown);
    const footer = chrome.footer?.length ? " with-footer" : "";
    const stateClass = state ? ` state-${state}` : el.status ? ` status-${el.status}` : "";
    const className = `${display}${stateClass}${footer}${el.id === input.focusId ? " focused" : ""}`;
    const decorations = decorationsOf(el, input, source);
    const key = [
      source.length,
      el.status,
      state,
      el.review,
      el.functionName,
      el.pressureLevel,
      attempt ? `${attempt.n}/${attempt.of}` : "",
      className,
      chrome.footer?.length ?? 0,
      decorationKey(decorations, input.terms.version),
    ].join("|");
    items.push({
      id: el.id,
      x: pos.x,
      y: pos.y,
      width: w,
      height: h,
      className,
      source,
      markdown: isMarkdown(el),
      version: versionOf(el.id, key),
      decorate: makeDecorate(decorations),
      label: chrome.label,
      header: chrome.header,
      footer: chrome.footer,
      placeholder: chrome.placeholder,
    });
  }
  // Edge notes (FR-040): a chip above each noted question edge, and "+ note" on the focused one.
  for (const el of elements) {
    if (el.kind !== "question" || !input.visible(el)) continue;
    const focused = el.id === input.focusId;
    if (!el.note && !focused) continue;
    const pos = input.dragOverride.get(el.id) ?? layout.positions.get(el.id);
    if (!pos) continue;
    const label = el.note ?? "+ note";
    items.push({
      id: noteItemId(el.id),
      x: pos.x + 8,
      y: pos.y - NOTE_CHIP.h - 4,
      width: NOTE_CHIP.w,
      height: NOTE_CHIP.h,
      className: `note-chip${el.note ? "" : " empty"}`,
      source: "",
      markdown: false,
      version: versionOf(noteItemId(el.id), `${label}|${focused}`),
      label: el.note ? `Note: ${el.note}` : "Add a note",
      header: [{ action: "edit-note", label, title: el.note ? "Edit or clear this note" : "Add a short note to this edge" }],
    });
  }
  return { draw, items };
}

export const NOTE_CHIP = { w: 240, h: 22 };
const NOTE_PREFIX = "note:";
export const noteItemId = (edgeId: string) => `${NOTE_PREFIX}${edgeId}`;
export const edgeOfNoteItem = (itemId: string) => (itemId.startsWith(NOTE_PREFIX) ? itemId.slice(NOTE_PREFIX.length) : null);
