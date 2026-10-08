import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { activeTerms, allTerms, CHECKS, DATA, findTerm, SLOT_ORDER, Term } from "@/shared/lexicon";
import { buildLock, type Lock, lockProblems } from "@/server/lexicon/lock";

const lockFile = path.resolve(import.meta.dirname, "../../src/shared/lexicon/data/versions.lock.json");

describe("lexicon registry data (FR-001–FR-005, FR-019)", () => {
  it("launches with the base set: at least 65 active terms, in every slot", () => {
    expect(activeTerms().length).toBeGreaterThanOrEqual(65);
    const counts = Object.fromEntries(SLOT_ORDER.map((s) => [s, activeTerms().filter((t) => t.slot === s).length]));
    expect(counts).toEqual({ operation: 26, scope: 8, format: 6, tone: 5, audience: 5, strength: 11, quality: 8 });
  });

  it("every entry matches the schema and lives in its slot's file", () => {
    for (const slot of SLOT_ORDER) {
      for (const raw of DATA[slot]) {
        const t = Term.parse(raw);
        expect(t.slot, t.id).toBe(slot);
      }
    }
  });

  it("ids are unique, and names and aliases are unique ignoring case", () => {
    const ids = allTerms().map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const seen = new Map<string, string>();
    for (const t of allTerms()) {
      for (const form of [t.name, ...t.aliases].map((s) => s.toLowerCase())) {
        expect(seen.get(form), `"${form}" is used by ${seen.get(form)} and ${t.id}`).toBeUndefined();
        seen.set(form, t.id);
      }
    }
  });

  it("neighbours exist and aren't the term itself; conflicts exist and are mutual", () => {
    for (const t of allTerms()) {
      for (const n of t.neighbours) {
        expect(findTerm(n), `${t.id} → neighbour ${n}`).toBeDefined();
        expect(n).not.toBe(t.id);
      }
      for (const c of t.conflicts) {
        expect(findTerm(c), `${t.id} → conflict ${c}`).toBeDefined();
        expect(findTerm(c)!.conflicts, `${c} must list ${t.id} back`).toContain(t.id);
      }
    }
  });

  it("instructions are calm, one paragraph, and checked where they declare a check", () => {
    for (const t of allTerms()) {
      expect(t.instruction.length, t.id).toBeLessThanOrEqual(400);
      expect(t.instruction, t.id).toMatch(/[.!?"]$/);
      expect(t.instruction, t.id).not.toMatch(/\n/);
      // No shouting (research: overtriggering): no all-caps words beyond acronyms of 2-5 letters.
      expect(t.instruction, t.id).not.toMatch(/\b(MUST|NEVER|ALWAYS|CRITICAL|IMPORTANT)\b/);
      if (t.check) expect(CHECKS[t.check], `${t.id} → check ${t.check}`).toBeDefined();
    }
  });

  it("the version lock matches: an instruction can't change without a version increase", () => {
    const lock = JSON.parse(readFileSync(lockFile, "utf8")) as Lock;
    expect(lockProblems(allTerms(), lock)).toEqual([]);
  });

  it("the lock check catches an unversioned change, a deletion and a version without a change", () => {
    const terms = allTerms();
    const lock = buildLock(terms);
    const changed = terms.map((t) => (t.id === "distill" ? { ...t, instruction: `${t.instruction} More.` } : t));
    expect(lockProblems(changed, lock)).toEqual([expect.stringMatching(/^distill: instruction changed without a version increase/)]);
    const bumped = changed.map((t) => (t.id === "distill" ? { ...t, version: 2 } : t));
    expect(lockProblems(bumped, lock)).toEqual([expect.stringMatching(/^distill: lock is behind/)]);
    expect(lockProblems(terms.map((t) => (t.id === "table" ? { ...t, version: 2 } : t)), lock)).toEqual([
      expect.stringMatching(/^table: version increased but the instruction is unchanged/),
    ]);
    expect(lockProblems(terms.filter((t) => t.id !== "table"), lock)).toEqual([expect.stringMatching(/^table: removed/)]);
  });
});
