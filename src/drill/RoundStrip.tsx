"use client";

// The round strip (FR-009, FR-020, FR-022): one chip per problem with its result, to reopen any of
// them; End round while the round is open; and the round's note once it has ended.
import { drillApi } from "@/lib/api";
import type { Drill, DrillRound } from "@/shared/schemas";
import { VERDICT_LABEL } from "./ProblemView";
import { useDrillStore } from "./store";

const SYMBOL = { solved: "✓", partly_solved: "~", not_solved: "✗", unattempted: "·" } as const;

export function RoundNote({ drill, round }: { drill: Drill; round: DrillRound }) {
  const name = (id: string) => drill.ladder.rungs.find((r) => r.id === id)?.name ?? "?";
  const attemptNumber = new Map(round.problems.flatMap((p) => p.attempts.map((a) => [a.attempt.id, p.position + 1] as const)));
  if (!round.ended) return null;
  return (
    <div className="drill-note" data-testid="drill-round-note">
      <span className="drill-label">Round {round.number}</span> <span className="ai-tag">AI</span>
      {round.note.length === 0 ? (
        <span className="drill-muted"> No level changed.</span>
      ) : (
        <ul>
          {round.note.map((n) => (
            <li key={n.changeId}>
              {name(n.rungId)}:{" "}
              {n.fromState === "locked" && n.toState === "open"
                ? "opened at level 1"
                : n.from === n.to
                  ? `${n.toState} at level ${n.to}`
                  : `level ${n.from} → ${n.to}${n.toState !== n.fromState ? `, now ${n.toState}` : ""}`}
              {n.cause === "recompute" && " (recomputed after your override)"}
              {n.evidence.length > 0 && (
                <span className="drill-muted">
                  {" "}
                  from {n.evidence.length} attempt{n.evidence.length > 1 ? "s" : ""}
                  {(() => {
                    const ps = [...new Set(n.evidence.map((e) => attemptNumber.get(e)).filter(Boolean))];
                    return ps.length ? ` on problem ${ps.join(", ")}` : " (redone from earlier rounds)";
                  })()}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {round.shortNote && <p className="drill-muted">{round.shortNote}</p>}
    </div>
  );
}

export function RoundStrip({ round, shownId }: { round: DrillRound; shownId: string | null }) {
  const run = useDrillStore((s) => s.run);
  const busy = useDrillStore((s) => s.busy);
  const openProblem = useDrillStore((s) => s.openProblem);
  return (
    <div className="drill-strip" aria-label={`Round ${round.number}`}>
      <span className="drill-label">Round {round.number}</span>
      {round.problems.map((p) => (
        <button
          key={p.element.id}
          type="button"
          className={`drill-chip v-${p.result}${p.element.id === shownId ? " current" : ""}${p.flagged ? " flagged" : ""}${p.skipped ? " skipped" : ""}`}
          title={`Problem ${p.position + 1}: ${VERDICT_LABEL[p.result]}${p.flagged ? ", flagged" : ""}${p.skipped ? ", skipped" : ""}`}
          onClick={() => openProblem(p.element.id)}
        >
          {p.position + 1} {SYMBOL[p.result]}
        </button>
      ))}
      {!round.ended && (
        <button
          type="button"
          className="btn btn-small"
          data-testid="drill-end-round"
          disabled={!!busy}
          onClick={() => void run("end", () => drillApi.endRound(round.roundId, "user"))}
        >
          {busy === "end" ? "Ending…" : "End round"}
        </button>
      )}
    </div>
  );
}
