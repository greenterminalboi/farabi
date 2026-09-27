import type { SuggestedSpan } from "@/shared/schemas";

const MAX_SPANS = 3;
const MIN_WORDS = 2;
const MAX_WORDS = 20;
const MAX_CHARS = 200;
// Markdown syntax: a span containing any of these may not render as its stored text (research R2).
const MARKDOWN = /[`*[\]<>|#]/;

/**
 * Turns the model's phrases into validated ranges of `content` (research R2): exact first
 * occurrence only, 2–20 words, plain prose on one line, no overlaps, at most 3 (FR-008).
 */
export function locateSpans(content: string, phrases: string[]): SuggestedSpan[] {
  const found: SuggestedSpan[] = [];
  for (const raw of phrases) {
    const text = raw.trim();
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words < MIN_WORDS || words > MAX_WORDS || text.length > MAX_CHARS) continue;
    if (text.includes("\n") || MARKDOWN.test(text)) continue;
    const start = content.indexOf(text);
    if (start === -1) continue;
    found.push({ start, end: start + text.length, text });
  }
  const kept: SuggestedSpan[] = [];
  for (const span of found.sort((a, b) => a.start - b.start)) {
    if (kept.some((k) => span.start < k.end && span.end > k.start)) continue;
    kept.push(span);
  }
  return kept.slice(0, MAX_SPANS);
}
