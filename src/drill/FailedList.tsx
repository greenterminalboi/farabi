"use client";

// Open failed problems from earlier rounds (FR-023): not solved or partly solved, each with Redo.
// A redo counts toward the round it is made in (FR-023 AS2).
import type { Drill } from "@/shared/schemas";
import { VERDICT_LABEL } from "./ProblemView";
import { useDrillStore } from "./store";

export function FailedList({ drill }: { drill: Drill }) {
  const openProblem = useDrillStore((s) => s.openProblem);
  const failed = drill.rounds
    .filter((r) => r.ended)
    .flatMap((r) => r.problems.map((p) => ({ p, round: r.number })))
    .filter(({ p }) => !p.flagged && (p.result === "not_solved" || p.result === "partly_solved"));
  if (failed.length === 0) return null;
  return (
    <section className="drill-failed" data-testid="drill-failed">
      <h3>To revisit</h3>
      <ul>
        {failed.map(({ p, round }) => (
          <li key={p.element.id}>
            <span className={`drill-badge v-${p.result}`}>{VERDICT_LABEL[p.result]}</span>{" "}
            <span className="drill-muted">Round {round}:</span> {(p.element.text ?? "").slice(0, 80)}
            {(p.element.text ?? "").length > 80 ? "…" : ""}{" "}
            <button type="button" className="btn btn-small" onClick={() => openProblem(p.element.id)}>
              Redo
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
