"use client";

// A rung's lesson (FR-006): shown when the rung opens, before its first problems; dismissible, and
// reachable from its rung afterwards.
import type { DrillRound } from "@/shared/schemas";
import { AiTag, ElementText } from "./ElementText";
import { useDrillStore } from "./store";

export function LessonView({ lesson, rungName }: { lesson: DrillRound["lessons"][number]; rungName: string }) {
  const closeLesson = useDrillStore((s) => s.closeLesson);
  return (
    <section className="drill-lesson" data-testid="drill-lesson">
      <header className="drill-row">
        <span className="drill-label">New rung: {rungName}</span>
        <AiTag />
        <button type="button" className="btn btn-small chrome-right" onClick={() => closeLesson(lesson.id)}>
          Got it
        </button>
      </header>
      <ElementText element={lesson} />
    </section>
  );
}
