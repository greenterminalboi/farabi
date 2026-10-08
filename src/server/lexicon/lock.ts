// The lexicon version lock (data-model.md "Version lock"): each term's version and a hash of its
// instruction, so an instruction can't change without a version increase (FR-004).
import { createHash } from "node:crypto";
import type { Term } from "@/shared/lexicon";

export type LockEntry = { v: number; sha: string };
export type Lock = Record<string, LockEntry>;

export function instructionHash(instruction: string): string {
  return createHash("sha256").update(instruction, "utf8").digest("hex").slice(0, 16);
}

/** Problems between the terms and a lock: changed instructions at the same version, missing entries. */
export function lockProblems(terms: Term[], lock: Lock): string[] {
  const problems: string[] = [];
  for (const t of terms) {
    const entry = lock[t.id];
    const sha = instructionHash(t.instruction);
    if (!entry) problems.push(`${t.id}: not in the lock (run npm run lexicon:lock)`);
    else if (t.version < entry.v) problems.push(`${t.id}: version went down from ${entry.v} to ${t.version}`);
    else if (t.version === entry.v && entry.sha !== sha) problems.push(`${t.id}: instruction changed without a version increase (bump "version")`);
    else if (t.version > entry.v && entry.sha === sha) problems.push(`${t.id}: version increased but the instruction is unchanged`);
    else if (t.version > entry.v) problems.push(`${t.id}: lock is behind (run npm run lexicon:lock)`);
  }
  for (const id of Object.keys(lock)) {
    if (!terms.some((t) => t.id === id)) problems.push(`${id}: removed from the data (retire terms, never delete them)`);
  }
  return problems;
}

/** The lock for the terms, keeping keys in registry order. */
export function buildLock(terms: Term[]): Lock {
  return Object.fromEntries(terms.map((t) => [t.id, { v: t.version, sha: instructionHash(t.instruction) }]));
}
