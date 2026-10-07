// Client state for the drill screen (contracts/drill-ui.md): the drill as last returned by the
// server, the problem being shown, and the action in flight. Data always comes from the server.
import { create } from "zustand";
import { ApiError } from "@/lib/api";
import type { Drill, DrillStepResponse } from "@/shared/schemas";

type Failure = { code: string; message: string; attemptId?: string };

type DrillStore = {
  drill: Drill | null;
  /** A problem the user reopened from the round strip or failed list; else the current one. */
  openProblemId: string | null;
  /** Lessons the user closed this visit; each stays reachable from its rung (FR-006). */
  closedLessons: Set<string>;
  shownLessonId: string | null;
  busy: string | null;
  error: Failure | null;
  nextRoundError: Failure | null;
  set: (drill: Drill) => void;
  openProblem: (id: string | null) => void;
  showLesson: (id: string | null) => void;
  closeLesson: (id: string) => void;
  /** Runs an action that returns the drill; errors are kept for the screen to show. */
  run: (name: string, fn: () => Promise<{ drill: Drill } & Partial<DrillStepResponse>>) => Promise<(Partial<DrillStepResponse> & { drill: Drill }) | null>;
  clearError: () => void;
};

export const useDrillStore = create<DrillStore>()((set, get) => ({
  drill: null,
  openProblemId: null,
  closedLessons: new Set(),
  shownLessonId: null,
  busy: null,
  error: null,
  nextRoundError: null,
  set: (drill) => set({ drill }),
  openProblem: (openProblemId) => set({ openProblemId }),
  showLesson: (shownLessonId) => set({ shownLessonId }),
  closeLesson: (id) => set((s) => ({ closedLessons: new Set([...s.closedLessons, id]), shownLessonId: s.shownLessonId === id ? null : s.shownLessonId })),
  run: async (name, fn) => {
    if (get().busy) return null;
    set({ busy: name, error: null });
    try {
      const res = await fn();
      set({ drill: res.drill, nextRoundError: res.nextRoundError ?? (res.drill.rounds.length && !res.drill.rounds.at(-1)!.ended ? null : get().nextRoundError) });
      return res;
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { attemptId?: string } | undefined) : undefined;
      set({
        error:
          err instanceof ApiError
            ? { code: err.code, message: err.message, attemptId: body?.attemptId }
            : { code: "network", message: "Couldn't reach Farabi. Check that it's running." },
      });
      return null;
    } finally {
      set({ busy: null });
    }
  },
  clearError: () => set({ error: null }),
}));

/** Exposed for tests (contracts/drill-ui.md "Test hooks"). */
export function publishTestHook(drill: Drill | null): void {
  if (process.env.NEXT_PUBLIC_FARABI_TEST_HOOKS !== "1" || typeof window === "undefined") return;
  (window as unknown as { __drill?: object }).__drill = drill
    ? { drillId: drill.drillId, currentProblemId: drill.rounds.at(-1)?.currentProblemId ?? null }
    : undefined;
}
