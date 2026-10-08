"use client";

// The drill screen (FR-004, contracts/drill-ui.md): header, ladder, the lesson when a rung opens,
// one problem at a time, the round strip with its note, open failed problems and, once complete,
// the drill-on offer. It resumes where the user left off (FR-025).
import { useCallback, useEffect, useRef } from "react";
import { drillApi, ApiError } from "@/lib/api";
import type { Drill } from "@/shared/schemas";
import { DrillHeader } from "./DrillHeader";
import { DrillSelectionToolbar } from "./DrillSelectionToolbar";
import { FailedList } from "./FailedList";
import { Ladder } from "./Ladder";
import { LessonView } from "./LessonView";
import { OfferCards } from "./OfferCards";
import { ProblemView } from "./ProblemView";
import { RoundNote, RoundStrip } from "./RoundStrip";
import { publishTestHook, useDrillStore } from "./store";

function findProblem(drill: Drill, id: string) {
  for (const r of drill.rounds) {
    const p = r.problems.find((x) => x.element.id === id);
    if (p) return { round: r, problem: p };
  }
  return null;
}

/** The round is waiting on nothing but skipped problems: offer to end it. */
const onlySkippedLeft = (round: Drill["rounds"][number]) =>
  round.currentProblemId === null && round.problems.some((p) => p.skipped && p.result === "unattempted" && !p.flagged);

export function DrillScreen({ drillId }: { drillId: string }) {
  const drill = useDrillStore((s) => s.drill);
  const error = useDrillStore((s) => s.error);
  const busy = useDrillStore((s) => s.busy);
  const nextRoundError = useDrillStore((s) => s.nextRoundError);
  const openProblemId = useDrillStore((s) => s.openProblemId);
  const shownLessonId = useDrillStore((s) => s.shownLessonId);
  const closedLessons = useDrillStore((s) => s.closedLessons);
  const run = useDrillStore((s) => s.run);
  const root = useRef<HTMLDivElement>(null);
  const loadError = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { drill } = await drillApi.get(drillId);
      useDrillStore.setState({ drill, openProblemId: window.location.hash.slice(1) || null });
      // A round whose every problem got a result just before a reload ends now (FR-022).
      const last = drill.rounds.at(-1);
      if (last && !last.ended && last.problems.length > 0 && last.problems.every((p) => p.flagged || p.result !== "unattempted")) {
        await useDrillStore.getState().run("end", () => drillApi.endRound(last.roundId, "all_answered"));
      }
    } catch (err) {
      loadError.current = err instanceof ApiError && err.status === 404 ? "This drill doesn't exist, or its project is in the trash." : "Couldn't load the drill.";
      useDrillStore.setState({ drill: null, error: { code: "load", message: loadError.current } });
    }
  }, [drillId]);

  useEffect(() => {
    useDrillStore.setState({ drill: null, openProblemId: null, error: null, nextRoundError: null, closedLessons: new Set(), shownLessonId: null });
    void load();
  }, [load]);

  useEffect(() => publishTestHook(drill), [drill]);

  if (!drill) {
    return <div className="drill-screen drill-loading">{error ? <p className="drill-error">{error.message}</p> : <p className="drill-muted">Loading…</p>}</div>;
  }

  const round = drill.rounds.at(-1) ?? null;
  const roundOpen = !!round && !round.ended;
  const opened = openProblemId ? findProblem(drill, openProblemId) : null;
  const shown = opened ?? (roundOpen && round.currentProblemId ? findProblem(drill, round.currentProblemId) : null);
  const needsRound = drill.started && (!round || !!round.ended);
  // A new rung's lesson comes before its problems, once the user moves on from the one on screen.
  const autoLesson = roundOpen && !opened ? round.lessons.find((l) => !closedLessons.has(l.id)) : undefined;
  const lesson = shownLessonId ? drill.rounds.flatMap((r) => r.lessons).find((l) => l.id === shownLessonId) : autoLesson;
  const rungName = (id: string) => drill.ladder.rungs.find((r) => r.id === id)?.name ?? "";
  const next = () => useDrillStore.getState().openProblem(null);

  return (
    <div className="drill-screen" ref={root}>
      <DrillHeader drill={drill} />
      <div className="drill-body">
        <Ladder drill={drill} />
        <main className="drill-main">
          {error && (
            <div className="drill-error" role="alert">
              {error.message}{" "}
              <button type="button" className="toast-link" onClick={() => useDrillStore.getState().clearError()}>
                Dismiss
              </button>
            </div>
          )}
          {!drill.started && <p className="drill-muted">Check the ladder: rename, reorder, remove or add rungs, then Start. Rung 1 opens with a short lesson.</p>}
          <OfferCards drill={drill} />
          {lesson && <LessonView lesson={lesson} rungName={rungName(lesson.rungId)} />}
          {!lesson && shown && (
            <ProblemView key={shown.problem.element.id} drill={drill} problem={shown.problem} roundOpen={shown.round === round && roundOpen} onNext={next} />
          )}
          {!lesson && roundOpen && !shown && (
            <div className="drill-panel">
              {onlySkippedLeft(round) ? (
                <p>Only skipped problems are left. Open one from the strip, or end the round.</p>
              ) : (
                <p className="drill-muted">{busy === "end" ? "Ending the round…" : "Every problem has a result."}</p>
              )}
            </div>
          )}
          {needsRound && (
            <div className="drill-panel" data-testid="drill-next-round">
              {round && <RoundNote drill={drill} round={round} />}
              {nextRoundError && <p className="drill-error">The next round couldn&apos;t be written: {nextRoundError.message}</p>}
              <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void run("round", () => drillApi.nextRound(drill.drillId))}>
                {busy === "round" ? "Writing the next round…" : "Generate next round"}
              </button>
            </div>
          )}
          {round && <RoundStrip round={round} shownId={shown?.problem.element.id ?? null} />}
          {drill.rounds.length > 1 && <RoundNote drill={drill} round={drill.rounds.at(-2)!} />}
          <FailedList drill={drill} />
        </main>
      </div>
      <DrillSelectionToolbar root={root} />
    </div>
  );
}
