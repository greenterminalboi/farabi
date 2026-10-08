// Element boxes on the canvas (contracts/canvas-ui.md "Elements as drawn", research R10). One place
// for widths, frame parts and where the text sits inside a frame, shared by layout, the renderer,
// the text layer and the overlays.
import { findKind } from "@/shared/kinds";
import type { Display } from "@/shared/kinds";
import type { Element } from "@/shared/schemas";

export const WIDTH: Record<Display, number> = {
  answer: 480,
  question: 360,
  output: 320,
  drill: 320,
  // No box: a connector. Its outputs sit under a virtual column this wide.
  function_connector: 320,
};

/** The answer and output frame header: AI tag, state, ƒ and actions. */
export const HEADER = 30;
/** Incomplete or stopped answers end with a status line and Retry. */
export const FOOTER = 34;
/** A failed answer is a compact error stub with Retry. */
export const FAILED_HEIGHT = 74;
/** The shortest a question bubble gets (one line of text). */
export const MIN_BUBBLE = 46;
/** The shortest an answer or output frame gets. */
export const MIN_CARD = 84;
/** Feature 13: the row of lexicon chips at the foot of a question bubble that has terms. */
export const LEXICON_ROW = 26;
/** A function connector's label chip ("Analogy →"), the only part of it with a box. */
export const CHIP = { w: 168, h: 28 };

/** Text box padding, matching `.element-text` and its display classes in globals.css. */
export const PADDING: Record<"answer" | "question" | "output" | "drill", { x: number; y: number }> = {
  answer: { x: 18, y: 14 },
  question: { x: 16, y: 11 },
  output: { x: 16, y: 12 },
  drill: { x: 16, y: 12 },
};

export const FONT_SIZE = 15;
export const LINE_HEIGHT = 15 * 1.55;
/** Space after each block (`.element-text > * { margin-bottom: 0.6em }`). */
export const BLOCK_GAP = 15 * 0.6;

export function displayOf(el: Pick<Element, "kind">): Display {
  return findKind(el.kind)?.display ?? "output";
}

export function widthOf(el: Pick<Element, "kind">): number {
  return WIDTH[displayOf(el)];
}

/** A function edge is drawn as a connector, so it has no box of its own (FR-048). */
export function hasBox(el: Pick<Element, "kind">): boolean {
  return displayOf(el) !== "function_connector";
}

export type Box = { x: number; y: number; w: number; h: number };

/** Frame parts above and below an element's text. */
export function chrome(el: Pick<Element, "kind" | "status" | "lexicon">): { top: number; bottom: number } {
  const display = displayOf(el);
  if (display === "question") return { top: 0, bottom: el.lexicon?.length ? LEXICON_ROW : 0 };
  if (display === "function_connector") return { top: 0, bottom: 0 };
  const footer = el.status === "incomplete" || el.status === "stopped" ? FOOTER : 0;
  return { top: HEADER, bottom: footer };
}

/** Where an element's text sits inside its frame, in world units. */
export function textRect(el: Pick<Element, "kind" | "status" | "lexicon">, box: Box): Box {
  const { top, bottom } = chrome(el);
  return { x: box.x, y: box.y + top, w: box.w, h: Math.max(0, box.h - top - bottom) };
}

/** The frame height for a given text height (the text's own padding included). */
export function frameHeight(el: Pick<Element, "kind" | "status" | "lexicon">, textHeight: number): number {
  const display = displayOf(el);
  if (display === "function_connector") return CHIP.h;
  if (display === "answer" && el.status === "failed") return FAILED_HEIGHT;
  const { top, bottom } = chrome(el);
  const min = display === "question" ? MIN_BUBBLE : MIN_CARD;
  return Math.max(min, Math.ceil(top + textHeight + bottom));
}

/** The text shown in an element: a streaming answer shows what has arrived; a card its summary. */
export function textOf(el: Pick<Element, "text" | "status" | "partialText"> & Pick<Partial<Element>, "card">): string {
  if (el.card) return [el.card.title, ...el.card.lines].join("\n");
  if (el.status === "pending") return el.partialText ?? el.text ?? "";
  return el.text ?? "";
}

/** Answers render markdown; the user's own words and outputs are plain text. */
export function isMarkdown(el: Pick<Element, "kind">): boolean {
  return displayOf(el) === "answer";
}
