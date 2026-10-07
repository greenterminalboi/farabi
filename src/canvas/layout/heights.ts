// Element heights before their text is mounted (research R10). Measuring 5,000 elements in a hidden
// DOM is too slow to open in 1 s, so heights are estimated with canvas measureText over the same
// font and width, then replaced by the real height once an element is mounted in full.
import type { Element } from "@/shared/schemas";
import { BLOCK_GAP, displayOf, FONT_SIZE, frameHeight, LINE_HEIGHT, PADDING, textOf, widthOf } from "../geometry";

/** Bump when the CSS or the estimator changes, so stored heights are measured again. */
export const HEIGHTS_VERSION = 1;
const STORAGE_PREFIX = `farabi.heights.v${HEIGHTS_VERSION}:`;
const FONT = `${FONT_SIZE}px OpenDyslexic, system-ui, sans-serif`;
const BOLD_FONT = `700 ${FONT}`;

/** Measures a word's width in px; replaceable for tests and environments without a canvas. */
export type Measure = (word: string, bold: boolean) => number;

/** OpenDyslexic is wide: about 0.6 em per character. */
const fallbackMeasure: Measure = (word, bold) => word.length * FONT_SIZE * (bold ? 0.64 : 0.6);

let measureImpl: Measure | null = null;
const wordCache = new Map<string, number>();

function canvasMeasure(): Measure {
  if (typeof document === "undefined") return fallbackMeasure;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return fallbackMeasure;
  return (word, bold) => {
    ctx.font = bold ? BOLD_FONT : FONT;
    return ctx.measureText(word).width;
  };
}

export function setMeasure(measure: Measure | null): void {
  measureImpl = measure;
  wordCache.clear();
}

function wordWidth(word: string, bold: boolean): number {
  const key = bold ? `b:${word}` : word;
  let w = wordCache.get(key);
  if (w === undefined) {
    measureImpl ??= canvasMeasure();
    w = measureImpl(word, bold);
    wordCache.set(key, w);
  }
  return w;
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const HEADING = /^\s*#{1,6}\s+/;
const QUOTE = /^\s*>\s?/;
const SYNTAX = /[*_`~]/g;

/** Lines `text` wraps to in `room` px, by greedy word wrap over cached word widths. */
function wrappedLines(text: string, room: number, bold: boolean): number {
  const space = wordWidth(" ", false);
  let lines = 1;
  let x = 0;
  for (const word of text.split(" ")) {
    if (!word) continue;
    const w = wordWidth(word, bold);
    if (x > 0 && x + w > room) {
      lines += Math.ceil(w / room);
      x = w % room;
    } else x += w + space;
  }
  return lines;
}

/**
 * Height of an element's text, without parsing it (research R10): 5,000 answers have to be laid
 * out before the canvas opens, so markdown is read line by line, its syntax skipped, and each
 * block wrapped at the text width. Close enough for layout; the real height replaces it once the
 * element is mounted in full.
 */
function estimateLines(source: string, markdown: boolean, width: number): { lines: number; blocks: number } {
  let lines = 0;
  let blocks = 0;
  let inBlock = false;
  let fence = false;
  for (const raw of source.split("\n")) {
    if (markdown && raw.trimStart().startsWith("```")) {
      fence = !fence;
      if (!inBlock) {
        blocks++;
        inBlock = true;
      }
      continue;
    }
    if (!raw.trim()) {
      if (!markdown) {
        lines++;
        continue;
      }
      inBlock = false;
      continue;
    }
    let text = raw;
    let room = width;
    let bold = false;
    if (markdown && !fence) {
      const list = LIST_ITEM.exec(text);
      if (list) {
        // Each list item is its own block (rich text renders them that way).
        text = text.slice(list[0].length);
        room -= FONT_SIZE * 1.2 * Math.max(1, Math.floor(list[0].length / 2));
        blocks++;
        inBlock = true;
      } else if (HEADING.test(text)) {
        text = text.replace(HEADING, "");
        bold = true;
        blocks++;
        inBlock = false;
      } else {
        text = text.replace(QUOTE, "");
        if (!inBlock) {
          blocks++;
          inBlock = true;
        }
      }
      text = text.replace(SYNTAX, "");
    } else if (!inBlock) {
      blocks++;
      inBlock = true;
    }
    lines += wrappedLines(text, Math.max(40, room), bold);
  }
  return { lines, blocks: Math.max(1, blocks) };
}

/** Height of an element's text box, padding included, at its kind's width. */
export function estimateTextHeight(el: Pick<Element, "id" | "kind" | "text" | "status" | "partialText">): number {
  const display = displayOf(el);
  if (display === "function_connector") return 0;
  const pad = PADDING[display];
  const width = widthOf(el) - pad.x * 2;
  const source = textOf(el);
  if (!source) return pad.y * 2 + LINE_HEIGHT;
  const markdown = display === "answer";
  const { lines, blocks } = estimateLines(source, markdown, width);
  // Plain text keeps its line breaks in one block; markdown blocks are spaced apart.
  const gaps = markdown ? (blocks - 1) * BLOCK_GAP : 0;
  return Math.ceil(pad.y * 2 + Math.max(LINE_HEIGHT, lines * LINE_HEIGHT + gaps));
}

const measured = new Map<string, number>();

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Stores the real text height of an element mounted with its full text. */
export function recordMeasured(id: string, textHeight: number): void {
  measured.set(id, textHeight);
  try {
    storage()?.setItem(STORAGE_PREFIX + id, String(Math.round(textHeight)));
  } catch {
    // storage full or blocked: the in-memory value still applies
  }
}

export function measuredTextHeight(id: string): number | undefined {
  const hit = measured.get(id);
  if (hit !== undefined) return hit;
  try {
    const stored = storage()?.getItem(STORAGE_PREFIX + id);
    if (stored) {
      const n = Number(stored);
      if (Number.isFinite(n) && n > 0) {
        measured.set(id, n);
        return n;
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

/**
 * The frame height of an element: the measured text height when there is one (text is immutable,
 * so it stays right), else the estimate. A streaming answer is always estimated. Function edges
 * have no box.
 */
export function heightOf(el: Element): number {
  if (displayOf(el) === "function_connector") return frameHeight(el, 0);
  const text = el.status === "pending" ? undefined : measuredTextHeight(el.id);
  return frameHeight(el, text ?? estimateTextHeight(el));
}

/** Forgets every measured height (tests). */
export function resetHeights(): void {
  measured.clear();
  wordCache.clear();
}
