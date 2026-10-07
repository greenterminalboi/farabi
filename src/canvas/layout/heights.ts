// Element heights before their text is mounted (research R10). Measuring 5,000 elements in a hidden
// DOM is too slow to open in 1 s, so heights are estimated with canvas measureText over the same
// font and width, then replaced by the real height once an element is mounted in full.
import type { Element } from "@/shared/schemas";
import { BLOCK_GAP, displayOf, FONT_SIZE, frameHeight, LINE_HEIGHT, PADDING, textOf, widthOf } from "../geometry";
import { type Block, richTextFor } from "../text/richText";

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

/** Lines a block wraps to at `width`, by greedy word wrap. */
function blockLines(block: Block, width: number): number {
  if (block.tag === "hr") return 0.5;
  const indent = block.tag === "li" ? FONT_SIZE * 1.2 * Math.max(1, block.depth) : 0;
  const room = Math.max(40, width - indent);
  const space = wordWidth(" ", false);
  let lines = 1;
  let x = 0;
  for (const run of block.runs) {
    const bold = run.marks.includes("strong") || block.tag.startsWith("h");
    for (const part of run.text.split(/(\n)/)) {
      if (part === "\n") {
        lines++;
        x = 0;
        continue;
      }
      for (const word of part.split(" ")) {
        if (!word) {
          x += space;
          continue;
        }
        const w = wordWidth(word, bold);
        if (x > 0 && x + w > room) {
          lines += Math.ceil(w / room);
          x = w % room;
        } else x += w + space;
      }
    }
  }
  return lines;
}

/** Height of an element's text box, padding included, at its kind's width. */
export function estimateTextHeight(el: Pick<Element, "id" | "kind" | "text" | "status" | "partialText">): number {
  const display = displayOf(el);
  if (display === "function_connector") return 0;
  const pad = PADDING[display];
  const width = widthOf(el) - pad.x * 2;
  const source = textOf(el);
  if (!source) return pad.y * 2 + LINE_HEIGHT;
  const rich = richTextFor(el.id, source, display === "answer");
  let height = 0;
  for (const block of rich.blocks) height += blockLines(block, width) * LINE_HEIGHT + BLOCK_GAP;
  return Math.ceil(pad.y * 2 + Math.max(LINE_HEIGHT, height - BLOCK_GAP));
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
