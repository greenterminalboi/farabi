// Deterministic fake output for each drill operation (research R16), registered when the fake
// provider is in use. Integration and e2e tests drive progression with them: a verdict is
// `solved` when the attempt contains ✓, `partly_solved` for ~, and `not_solved` otherwise.
import { type FakeResponder, registerFakeCompletion } from "../../ai/fake";
import type { CompletionInput } from "../../ai/provider";
import type { DomainInput } from "./domain";
import type { OfferInput } from "./offer";
import type { RoundInput } from "./round";
import { readInputBlock } from "./types";
import type { VerdictInput } from "./verdict";

const json = (value: unknown) => JSON.stringify(value);

export function fakeLadder(): string {
  return json({ rungs: [1, 2, 3, 4, 5].map((i) => `Rung ${i}`) });
}

export function fakeRound(input: CompletionInput, n: number): string {
  const r = readInputBlock<RoundInput>(input.prompt);
  const name = (id: string) => r.ladder.find((x) => x.id === id)?.name ?? id;
  // A replacement gets the call number too, so it never repeats the problem it replaces.
  const suffix = r.replacing ? `x${n}` : "";
  return json({
    lessons: r.lessonRungIds.map((rungId) => ({ rungId, text: `Lesson on ${name(rungId)}: what it is, and one worked example.` })),
    problems: r.slots.map((slot, i) => ({
      text: `Problem r${r.roundNumber}-${i + 1}${suffix} on ${slot.rungIds.map(name).join(" + ")} L${slot.level}`,
      hint: `Hint for r${r.roundNumber}-${i + 1}${suffix}`,
      solution: `Solution for r${r.roundNumber}-${i + 1}${suffix}`,
      readAttachments: r.attachments.map((a) => a.nodeId),
    })),
  });
}

export function fakeVerdict(input: CompletionInput): string {
  const v = readInputBlock<VerdictInput>(input.prompt);
  const verdict = v.attempt.includes("✓") ? "solved" : v.attempt.includes("~") ? "partly_solved" : "not_solved";
  return json({ verdict, feedback: `You wrote: "${v.attempt.slice(0, 80)}". Judged ${verdict.replace("_", " ")}.` });
}

export function fakeOffer(input: CompletionInput): string {
  const o = readInputBlock<OfferInput>(input.prompt);
  return json({ picks: o.candidates.slice(0, 3).map((c) => ({ nodeId: c.nodeId, domain: `Drill on: ${c.text.slice(0, 40)}` })) });
}

export function fakeDomain(input: CompletionInput): string {
  const d = readInputBlock<DomainInput>(input.prompt);
  return json({ domain: `Domain from ${d.path.at(-1)?.slice(0, 40) ?? "nothing"}` });
}

/** Each operation, for registering its fake (avoids importing the operations here). */
export type WithFake = { id: string; fake: FakeResponder };

/** Registers every operation's fake responder (C5); call again to restore after a test overrides one. */
export function registerDrillFakes(ops: WithFake[]): void {
  for (const op of ops) registerFakeCompletion(op.id, op.fake);
}
