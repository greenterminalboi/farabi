import { z } from "zod";
import type { PlanSlot } from "../progression";
import { fakeRound } from "./fakes";
import type { AttachedText } from "./ladder";
import { type DrillOperation, inputBlock } from "./types";

export type RoundInput = {
  domain: string;
  roundNumber: number;
  ladder: Array<{ id: string; name: string }>;
  /** The problems to write, in order: their rungs and level (research R7). */
  slots: PlanSlot[];
  /** Rungs that just opened and need a lesson first (FR-006). */
  lessonRungIds: string[];
  /** Every earlier problem in the drill, each cut to 300 characters (R8). */
  earlier: string[];
  /** Recent not-solved or partly solved attempts with their feedback, up to 6 (FR-013). */
  mistakes: Array<{ problem: string; attempt: string; feedback: string }>;
  attachments: AttachedText[];
  /** Set when replacing a flagged problem; it must not be repeated either. */
  replacing?: string;
};

export type RoundOutput = {
  lessons: Array<{ rungId: string; text: string }>;
  problems: Array<{ text: string; hint: string; solution: string; readAttachments?: string[] }>;
};

/**
 * Per-level descriptors (FR-008), so a level means the same thing in every round of a drill. A
 * level is always described in terms of its rung.
 */
export const LEVEL_DESCRIPTORS = [
  "Levels 1–2: one direct step, with cues: the task says exactly what to do.",
  "Levels 3–4: a few steps, or a common edge case of the rung.",
  "Levels 5–6: fewer cues or an unfamiliar framing; may combine with another rung.",
  "Levels 7–8: several steps with a trap someone half-familiar would fall into.",
  "Levels 9–10: open-ended: design something or explain why, using the rung fully.",
];

export const EARLIER_CHARS = 300;
export const MAX_MISTAKES = 6;

/** Lessons for newly opened rungs and the problems that fill a round's plan exactly. */
export const drillRound: DrillOperation<RoundInput, RoundOutput> = {
  id: "drill_round",
  version: 1,
  effort: "medium",
  maxTokens: 8000,
  instruction: {
    system: [
      "You write practice material for a learner drilling one domain, rung by rung.",
      "These are practice problems from general knowledge. Never claim anything about the learner's own notes or thinking.",
      "",
      "Lessons: for each rung in lessonRungIds, write a short lesson in markdown: what the rung is and one worked example.",
      "",
      "Problems: write exactly one problem per slot, in slot order, at that slot's level, on that slot's rungs",
      "(a slot with two rungs is one problem that needs both). Each problem is self-contained and answerable in a few",
      "lines of text or code. Give each a one-line hint that doesn't give the answer away, and a worked solution.",
      ...LEVEL_DESCRIPTORS,
      "Never repeat or lightly reword an earlier problem. Where mistakes are listed, aim some problems at them.",
      "When attached conversations are given you may reuse their examples; list the nodeIds you used in readAttachments.",
      "",
      'Reply with only a JSON object: {"lessons": [{"rungId": "…", "text": "…"}], "problems": [{"text": "…", "hint": "…", "solution": "…", "readAttachments": []}]}',
    ].join("\n"),
    prompt: (input) =>
      [
        `Domain: ${input.domain}. Write round ${input.roundNumber}: ${input.slots.length} problem(s)` +
          (input.lessonRungIds.length ? ` and ${input.lessonRungIds.length} lesson(s).` : "."),
        input.replacing ? `This replaces a problem the learner flagged as wrong or unsuitable:\n${input.replacing}` : "",
        inputBlock(input),
      ]
        .filter(Boolean)
        .join("\n\n"),
  },
  output: z.object({
    lessons: z.array(z.object({ rungId: z.string(), text: z.string().trim().min(1).max(8000) })),
    problems: z.array(
      z.object({
        text: z.string().trim().min(1).max(4000),
        hint: z.string().trim().min(1).max(500),
        solution: z.string().trim().min(1).max(8000),
        readAttachments: z.array(z.string()).optional(),
      }),
    ),
  }),
  check: (out, input) => {
    if (out.problems.length !== input.slots.length) return `Write exactly ${input.slots.length} problems, one per slot`;
    const missing = input.lessonRungIds.filter((id) => !out.lessons.some((l) => l.rungId === id));
    if (missing.length) return `Write a lesson for each rung in lessonRungIds (missing ${missing.join(", ")})`;
    return null;
  },
  fake: fakeRound,
};

/**
 * Normalized problem text for the no-repeat check (R8): lowercase, punctuation and symbols
 * removed, whitespace collapsed.
 */
export function normalizeProblem(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits new problems into those to keep and those repeating an earlier one or each other. */
export function rejectDuplicates<P extends { text: string }>(problems: P[], earlier: string[]): { kept: P[]; rejected: P[] } {
  const seen = new Set(earlier.map(normalizeProblem));
  const kept: P[] = [];
  const rejected: P[] = [];
  for (const p of problems) {
    const key = normalizeProblem(p.text);
    if (seen.has(key)) rejected.push(p);
    else {
      seen.add(key);
      kept.push(p);
    }
  }
  return { kept, rejected };
}
