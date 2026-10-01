// Element text as blocks of runs with source offsets (research R9). Parsed once per immutable text
// and cached; the text layer renders it imperatively, outside React.
import type { Nodes, Parents, Root } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";

export type Mark = "strong" | "em" | "code";

/**
 * A piece of rendered text. `start`/`end` are raw offsets in the source when the rendered text maps
 * 1:1 onto it; null when it doesn't (escapes, entities, inline code), so it can't anchor anything.
 */
export type Run = { text: string; start: number | null; end: number | null; marks: Mark[] };

export type BlockTag = "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "li" | "pre" | "blockquote" | "hr";

/** `depth` is list nesting for `li`, quote nesting for `blockquote`; `ordered` numbers list items. */
export type Block = { tag: BlockTag; depth: number; ordered?: number; runs: Run[] };

export type RichText = { blocks: Block[]; chars: number };

const parser = unified().use(remarkParse);

const HEADINGS: BlockTag[] = ["h1", "h2", "h3", "h4", "h5", "h6"];

function inlineRuns(node: Nodes, marks: Mark[], out: Run[]): void {
  switch (node.type) {
    case "text": {
      const s = node.position?.start.offset;
      const e = node.position?.end.offset;
      const mapped = s !== undefined && e !== undefined && e - s === node.value.length;
      out.push({ text: node.value, start: mapped ? s : null, end: mapped ? e : null, marks });
      return;
    }
    case "inlineCode":
      out.push({ text: node.value, start: null, end: null, marks: [...marks, "code"] });
      return;
    case "break":
      out.push({ text: "\n", start: null, end: null, marks });
      return;
    case "strong":
    case "emphasis": {
      const next: Mark[] = [...marks, node.type === "strong" ? "strong" : "em"];
      for (const child of node.children) inlineRuns(child, next, out);
      return;
    }
    default:
      if ("children" in node) for (const child of (node as Parents).children) inlineRuns(child as Nodes, marks, out);
      else if ("value" in node && typeof node.value === "string") {
        out.push({ text: node.value, start: null, end: null, marks });
      }
  }
}

function collect(node: Nodes, out: Block[], listDepth: number, quoteDepth: number, ordered?: number): void {
  switch (node.type) {
    case "paragraph": {
      const runs: Run[] = [];
      for (const child of node.children) inlineRuns(child, [], runs);
      out.push({ tag: quoteDepth > 0 ? "blockquote" : "p", depth: quoteDepth, runs });
      return;
    }
    case "heading": {
      const runs: Run[] = [];
      for (const child of node.children) inlineRuns(child, [], runs);
      out.push({ tag: HEADINGS[node.depth - 1], depth: 0, runs });
      return;
    }
    case "code": {
      // Code blocks render as text but don't map 1:1 (fences, indentation), so they don't anchor.
      out.push({ tag: "pre", depth: 0, runs: [{ text: node.value, start: null, end: null, marks: ["code"] }] });
      return;
    }
    case "thematicBreak":
      out.push({ tag: "hr", depth: 0, runs: [] });
      return;
    case "blockquote":
      for (const child of node.children) collect(child, out, listDepth, quoteDepth + 1);
      return;
    case "list":
      node.children.forEach((item, i) => collect(item, out, listDepth + 1, quoteDepth, node.ordered ? (node.start ?? 1) + i : undefined));
      return;
    case "listItem": {
      // The item's first paragraph is the list entry; further blocks follow it as their own blocks.
      node.children.forEach((child, i) => {
        if (i === 0 && child.type === "paragraph") {
          const runs: Run[] = [];
          for (const c of child.children) inlineRuns(c, [], runs);
          out.push({ tag: "li", depth: listDepth, ordered, runs });
        } else collect(child, out, listDepth, quoteDepth);
      });
      if (node.children.length === 0) out.push({ tag: "li", depth: listDepth, ordered, runs: [] });
      return;
    }
    default:
      if ("children" in node) for (const child of (node as Parents).children) collect(child as Nodes, out, listDepth, quoteDepth);
  }
}

/** Markdown (an AI answer) to blocks and runs. */
export function parseRichText(source: string): RichText {
  const tree = parser.parse(source) as Root;
  const blocks: Block[] = [];
  for (const child of tree.children) collect(child, blocks, 0, 0);
  return { blocks, chars: countChars(blocks) };
}

/** Plain text (a user's message, an output) as one block per line, every character mapped. */
export function plainRichText(source: string): RichText {
  const blocks: Block[] = [];
  let offset = 0;
  for (const line of source.split("\n")) {
    blocks.push({ tag: "p", depth: 0, runs: line ? [{ text: line, start: offset, end: offset + line.length, marks: [] }] : [] });
    offset += line.length + 1;
  }
  return { blocks, chars: countChars(blocks) };
}

function countChars(blocks: Block[]): number {
  let n = 0;
  for (const b of blocks) for (const r of b.runs) n += r.text.length;
  return n;
}

const cache = new Map<string, { length: number; rich: RichText }>();

/** Cached by element id; a different length (a streaming answer) parses again. */
export function richTextFor(id: string, source: string, markdown: boolean): RichText {
  const hit = cache.get(id);
  if (hit && hit.length === source.length) return hit.rich;
  const rich = markdown ? parseRichText(source) : plainRichText(source);
  cache.set(id, { length: source.length, rich });
  return rich;
}

/** Below this many characters an element shows a preview, read without the markdown parser. */
export const PREVIEW_MAX = 120;

const BLOCK_PREFIX = /^[ \t]*(?:#{1,6}[ \t]+|[-*+][ \t]+|\d+[.)][ \t]+|>[ \t]?)*/;
const SYNTAX = new Set(["*", "_", "`", "~"]);

/**
 * The first characters of the first non-empty line, with markdown syntax skipped and every shown
 * character still mapped to its source offset. Zoomed out, thousands of elements each show a few
 * characters: parsing their markdown would cost more than the rest of the frame (M0, research R17).
 */
export function previewRichText(source: string, want: number): RichText {
  let lineStart = 0;
  while (lineStart < source.length) {
    const lineEnd = source.indexOf("\n", lineStart);
    const end = lineEnd === -1 ? source.length : lineEnd;
    if (source.slice(lineStart, end).trim()) break;
    lineStart = end + 1;
  }
  const lineEnd = source.indexOf("\n", lineStart) === -1 ? source.length : source.indexOf("\n", lineStart);
  let i = lineStart + (BLOCK_PREFIX.exec(source.slice(lineStart, lineEnd))?.[0].length ?? 0);
  const runs: Run[] = [];
  let runStart = -1;
  let shown = 0;
  const close = (at: number) => {
    if (runStart !== -1 && at > runStart) runs.push({ text: source.slice(runStart, at), start: runStart, end: at, marks: [] });
    runStart = -1;
  };
  while (i < lineEnd && shown < want * 2) {
    const ch = source[i];
    if (ch === "\\") {
      close(i);
      i += 2;
      continue;
    }
    if (SYNTAX.has(ch)) {
      close(i);
      i++;
      continue;
    }
    if (runStart === -1) runStart = i;
    shown++;
    i++;
  }
  close(i);
  return { blocks: [{ tag: "p", depth: 0, runs }], chars: shown };
}

const prefixCache = new Map<string, { length: number; end: number; rich: RichText }>();

/**
 * Parses only as much of `source` as `want` rendered characters need: up to the first paragraph
 * break past about twice that many source characters. Zoomed out, an element shows a few dozen
 * characters, so thousands of long answers never have to be parsed in full. `partial` says text
 * was left out, so the result counts as clipped even when everything parsed fits.
 */
export function richTextPrefix(
  id: string,
  source: string,
  markdown: boolean,
  want: number,
): { rich: RichText; partial: boolean } {
  if (markdown && want <= PREVIEW_MAX && source.length > want) {
    return { rich: previewRichText(source, want), partial: true };
  }
  let end = source.length;
  const reach = Math.max(want * 2, 400);
  if (reach < source.length) {
    const brk = source.indexOf("\n\n", reach);
    if (brk !== -1) end = brk;
  }
  if (end >= source.length) return { rich: richTextFor(id, source, markdown), partial: false };
  const hit = prefixCache.get(id);
  if (hit && hit.length === source.length && hit.end >= end) return { rich: hit.rich, partial: true };
  const head = source.slice(0, end);
  const rich = markdown ? parseRichText(head) : plainRichText(head);
  prefixCache.set(id, { length: source.length, end, rich });
  return { rich, partial: true };
}

/** Cuts a run's text at the last word boundary at or before `room` characters. */
function cutRun(run: Run, room: number): Run {
  let cut = room;
  const space = run.text.lastIndexOf(" ", room);
  if (space > 0) cut = space;
  return {
    text: run.text.slice(0, cut),
    start: run.start,
    end: run.start === null ? null : run.start + cut,
    marks: run.marks,
  };
}

/**
 * The prefix of `rich` that fits `budget` characters: whole blocks and runs, the last run cut at a
 * word boundary. Nothing past the budget is ever produced (FR-032, FR-033).
 */
export function clip(rich: RichText, budget: number): { blocks: Block[]; chars: number; clipped: boolean } {
  if (rich.chars <= budget) return { blocks: rich.blocks, chars: rich.chars, clipped: false };
  const blocks: Block[] = [];
  let used = 0;
  let full = false;
  for (const block of rich.blocks) {
    if (full) break;
    const runs: Run[] = [];
    for (const run of block.runs) {
      const room = budget - used;
      if (run.text.length <= room) {
        runs.push(run);
        used += run.text.length;
        continue;
      }
      const cut = cutRun(run, room);
      if (cut.text) runs.push(cut);
      used += cut.text.length;
      full = true;
      break;
    }
    blocks.push({ ...block, runs });
  }
  return { blocks, chars: used, clipped: true };
}
