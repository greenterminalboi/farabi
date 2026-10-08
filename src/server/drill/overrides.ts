// Overriding a verdict (FR-017, FR-021): a user-authored row; the AI verdict is kept. On a round
// that has ended, the round's changes are recomputed as new `recompute` rows; rounds already
// generated are never rewritten.
import { sql } from "kysely";
import { db, type Trx } from "../db/client";
import type { DrillVerdict } from "../db/schema";
import { drillElement } from "./elements";
import { loadSnapshot, roundOutcomes } from "./load";
import { levelChanges, type RungLevel, recomputeLevel } from "./progression";
import { asLadder, currentLevels, drillSettings, type DrillRow, latestLadder, lockDrill } from "./state";

export async function overrideVerdict(verdictId: string, verdict: DrillVerdict): Promise<string> {
  const { row, drill } = await drillElement(db, verdictId, "drill_verdict", "Verdict");
  await db.transaction().execute(async (trx) => {
    await lockDrill(trx, drill.id);
    await trx.insertInto("drill_verdict_overrides").values({ verdict_id: row.id, verdict }).execute();
    const { rows } = await sql<{ round_id: string }>`
      SELECT r.id AS round_id FROM nodes v
      JOIN nodes a ON a.id = v.parent_id JOIN nodes p ON p.id = a.parent_id JOIN nodes r ON r.id = p.parent_id
      WHERE v.id = ${row.id}`.execute(trx);
    await recompute(trx, drill, rows[0].round_id);
  });
  return drill.id;
}

/**
 * Recomputes an ended round's level changes from its results now (FR-021). Each rung's correction
 * is the difference between what the round should have done and what it did (its auto and earlier
 * recompute rows), applied to the rung's current level, so later rounds keep their effect. Rung
 * openings aren't redone. An open round needs nothing: it is computed when it ends.
 */
async function recompute(trx: Trx, drill: DrillRow, roundId: string): Promise<void> {
  const end = await trx.selectFrom("drill_round_ends").selectAll().where("round_id", "=", roundId).executeTakeFirst();
  if (!end) return;
  const snapshot = await loadSnapshot(trx, drill);
  const round = snapshot.rounds.find((r) => r.row.id === roundId)!;
  const outcomes = roundOutcomes(snapshot, round, end.created_at);
  const changes = await trx.selectFrom("drill_level_changes").selectAll().where("drill_id", "=", drill.id).orderBy("seq").execute();

  // Each rung's level just before the round's own changes, by the high-water mark at its end.
  const before = new Map<string, RungLevel>();
  for (const c of changes) if (BigInt(c.seq) <= BigInt(end.levels_seq)) before.set(c.rung_id, { level: c.to_level, state: c.to_state });
  const [ladder, current, settings] = await Promise.all([latestLadder(trx, drill.id), currentLevels(trx, drill.id), drillSettings(drill, trx)]);
  const corrected = levelChanges(outcomes, asLadder(ladder.rungs), before, settings).changes.filter((c) => c.fromState !== "locked");

  const mine = changes.filter((c) => c.round_id === roundId && (c.cause === "auto" || c.cause === "recompute") && c.from_state !== "locked");
  const rungs = new Set([...corrected.map((c) => c.rungId), ...mine.map((c) => c.rung_id)]);
  for (const rungId of rungs) {
    const did = mine.filter((c) => c.rung_id === rungId).reduce((sum, c) => sum + (c.to_level - c.from_level!), 0);
    const should = corrected.find((c) => c.rungId === rungId);
    const now = current.get(rungId);
    if (!now) continue;
    const next = recomputeLevel(now, { fromLevel: 0, toLevel: did }, should ?? null, settings);
    if (!next) continue;
    await trx
      .insertInto("drill_level_changes")
      .values({
        drill_id: drill.id,
        rung_id: rungId,
        round_id: roundId,
        from_level: now.level,
        to_level: next.level,
        from_state: now.state,
        to_state: next.state,
        cause: "recompute",
        provenance: "ai_suggested",
        evidence: outcomes.filter((o) => o.rungIds.includes(rungId)).flatMap((o) => o.attemptIds),
        supersedes: mine.filter((c) => c.rung_id === rungId).at(-1)?.id ?? null,
      })
      .execute();
  }
}
