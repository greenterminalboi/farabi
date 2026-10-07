"use client";

// One problem at a time (FR-009, FR-014–FR-018, FR-030): its text, an answer box, Submit, Hint,
// Show solution, Flag and Skip; after a verdict the badge, feedback, Override, Try again and Next;
// and the follow-up box, whose questions go to the canvas as branches off the drill node.
import { useState } from "react";
import { api, drillApi } from "@/lib/api";
import type { Drill, DrillProblem, DrillVerdict } from "@/shared/schemas";
import { drillHref, goToCanvas } from "./canvasLinks";
import { AiTag, ElementText } from "./ElementText";
import { useDrillStore } from "./store";

export const VERDICT_LABEL: Record<DrillVerdict | "unattempted", string> = {
  solved: "Solved",
  partly_solved: "Partly solved",
  not_solved: "Not solved",
  unattempted: "Not attempted",
};

function Attempts({ problem }: { problem: DrillProblem }) {
  const run = useDrillStore((s) => s.run);
  const busy = useDrillStore((s) => s.busy);
  return (
    <ol className="drill-attempts">
      {problem.attempts.map(({ attempt, verdict, override }, i) => (
        <li key={attempt.id} className="drill-attempt">
          <div className="drill-label">Your attempt {problem.attempts.length > 1 ? i + 1 : ""}</div>
          <ElementText element={attempt} markdown={false} className="drill-attempt-text" />
          {verdict ? (
            <div className="drill-verdict" data-testid="drill-verdict" data-verdict={override?.verdict ?? verdict.verdict}>
              <div className="drill-row">
                <AiTag />
                <span className={`drill-badge v-${verdict.verdict}${override ? " overridden" : ""}`}>{VERDICT_LABEL[verdict.verdict]}</span>
                {override && (
                  <span className={`drill-badge v-${override.verdict}`} title="Your verdict counts">
                    You: {VERDICT_LABEL[override.verdict]} ✓ counts
                  </span>
                )}
                {verdict.hinted && <span className="drill-muted">after a hint</span>}
                <select
                  className="drill-override"
                  data-testid="drill-override"
                  aria-label="Override the verdict"
                  value=""
                  disabled={!!busy}
                  onChange={(e) => void run("override", () => drillApi.override(verdict.id, e.target.value as DrillVerdict))}
                >
                  <option value="">Override…</option>
                  {(["solved", "partly_solved", "not_solved"] as const).map((v) => (
                    <option key={v} value={v}>
                      {VERDICT_LABEL[v]}
                    </option>
                  ))}
                </select>
              </div>
              <ElementText element={verdict} />
            </div>
          ) : (
            <div className="drill-verdict missing">
              <span className="drill-muted">Not judged yet.</span>
              <button type="button" className="btn btn-small" disabled={!!busy} onClick={() => void run("judge", () => drillApi.judge(attempt.id))}>
                Judge again
              </button>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function FollowUps({ drill, problem }: { drill: Drill; problem: DrillProblem }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = useDrillStore((s) => s.set);
  // Ask about the newest verdict when there is one, so its context includes the attempt (FR-030).
  const newest = [...problem.attempts].reverse().find((a) => a.verdict)?.verdict;
  const from = newest?.id ?? problem.element.id;

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.ask(from, text);
      setText("");
      const { drill: next } = await drillApi.get(drill.drillId);
      set(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the follow-up");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drill-followups">
      <form
        className="drill-row"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          data-testid="drill-followup"
          className="drill-input"
          placeholder={newest ? "Ask why, or about this verdict…" : "Ask about this problem…"}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn btn-small" disabled={busy || !text.trim()}>
          Ask on the canvas
        </button>
      </form>
      {error && <p className="drill-error">{error}</p>}
      {problem.followUps.length > 0 && (
        <ul className="drill-links" data-testid="drill-followup-links">
          {problem.followUps.map((f) => (
            <li key={f.edgeId}>
              <a
                href={`/?focus=${f.edgeId}`}
                onClick={(e) => {
                  e.preventDefault();
                  void goToCanvas(drill.projectId, { focus: f.edgeId, returnTo: drillHref(drill.drillId, problem.element.id) });
                }}
              >
                ↗ {f.text ?? "Branch"}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProblemView({ drill, problem, roundOpen, onNext }: { drill: Drill; problem: DrillProblem; roundOpen: boolean; onNext: () => void }) {
  const run = useDrillStore((s) => s.run);
  const busy = useDrillStore((s) => s.busy);
  const [answer, setAnswer] = useState("");
  const [again, setAgain] = useState(false);
  const [flagging, setFlagging] = useState<string | null>(null);
  const rungNames = problem.rungIds.map((id) => drill.ladder.rungs.find((r) => r.id === id)?.name ?? "?");
  const answered = problem.attempts.length > 0;
  const showBox = !problem.flagged && (!answered || again);

  async function submit() {
    // Stay on this problem to show its verdict; Next moves on (FR-009).
    useDrillStore.getState().openProblem(problem.element.id);
    const res = await run("attempt", () => drillApi.attempt(problem.element.id, answer));
    if (res) {
      setAnswer("");
      setAgain(false);
      // Every problem has a result: the round ends by itself (FR-022).
      const round = res.drill.rounds.at(-1);
      if (res.roundEnded && round && !round.ended) await run("end", () => drillApi.endRound(round.roundId, "all_answered"));
    } else {
      // A verdict that failed after the attempt was stored: the attempt shows with Judge again.
      const { error } = useDrillStore.getState();
      if (error?.attemptId) {
        setAnswer("");
        const { drill: next } = await drillApi.get(drill.drillId);
        useDrillStore.getState().set(next);
      }
    }
  }

  return (
    <section className="drill-problem" id={problem.element.id} data-testid="drill-current-problem" data-problem-id={problem.element.id}>
      <header className="drill-row">
        <AiTag />
        <span className="drill-muted">
          {rungNames.join(" + ")} · level {problem.level}
        </span>
        <span className={`drill-badge v-${problem.result}`}>{VERDICT_LABEL[problem.result]}</span>
        {problem.flagged && <span className="drill-badge flagged">Flagged</span>}
        {problem.replaces && <span className="drill-muted">replaces a flagged problem</span>}
      </header>
      <ElementText element={problem.element} className="drill-problem-text" />

      {problem.hint && (
        <div className="drill-hint">
          <span className="drill-label">Hint</span> <AiTag />
          <ElementText element={problem.hint} />
        </div>
      )}
      {problem.solution && (
        <div className="drill-solution">
          <span className="drill-label">Worked solution</span> <AiTag />
          <ElementText element={problem.solution} />
        </div>
      )}

      <Attempts problem={problem} />

      {showBox && (
        <form
          className="drill-answer"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <textarea
            data-testid="drill-answer"
            aria-label="Your answer"
            placeholder="Your answer"
            rows={5}
            maxLength={20000}
            value={answer}
            disabled={!!busy}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <div className="drill-row">
            <button type="submit" className="btn btn-primary" data-testid="drill-submit" disabled={!!busy || !answer.trim()}>
              {busy === "attempt" ? "Judging…" : "Submit"}
            </button>
            {!problem.hint && (
              <button type="button" className="btn" disabled={!!busy} onClick={() => void run("hint", () => drillApi.event(problem.element.id, "hint"))}>
                Hint
              </button>
            )}
            {!problem.solution && (
              <button
                type="button"
                className="btn"
                disabled={!!busy}
                title="Counts the problem as not solved"
                onClick={() => {
                  // A revealed problem counts as not solved; it stays on screen to read the solution.
                  useDrillStore.getState().openProblem(problem.element.id);
                  void run("reveal", () => drillApi.event(problem.element.id, "reveal"));
                }}
              >
                Show solution
              </button>
            )}
            {roundOpen && !answered && !problem.skipped && (
              <button
                type="button"
                className="btn"
                disabled={!!busy}
                onClick={async () => {
                  if (await run("skip", () => drillApi.event(problem.element.id, "skip"))) onNext();
                }}
              >
                Skip
              </button>
            )}
            <button type="button" className="btn" disabled={!!busy} onClick={() => setFlagging("")}>
              Flag
            </button>
          </div>
        </form>
      )}

      {flagging !== null && (
        <form
          className="drill-row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run("flag", () => drillApi.event(problem.element.id, "flag", flagging || undefined))) setFlagging(null);
          }}
        >
          <input className="drill-input" autoFocus placeholder="What's wrong with it? (optional)" value={flagging} onChange={(e) => setFlagging(e.target.value)} />
          <button type="submit" className="btn btn-small" disabled={!!busy}>
            Flag problem
          </button>
          <button type="button" className="btn btn-small" onClick={() => setFlagging(null)}>
            Cancel
          </button>
        </form>
      )}

      {answered && !showBox && (
        <div className="drill-row">
          {!problem.flagged && (
            <button type="button" className="btn" onClick={() => setAgain(true)}>
              Try again
            </button>
          )}
          <button type="button" className="btn btn-primary" data-testid="drill-next" onClick={onNext}>
            Next
          </button>
        </div>
      )}
      {problem.flagged && roundOpen && (
        <button type="button" className="btn btn-small" disabled={!!busy} onClick={() => void run("replace", () => drillApi.replace(problem.element.id))}>
          Add a replacement problem
        </button>
      )}

      <FollowUps drill={drill} problem={problem} />
    </section>
  );
}
