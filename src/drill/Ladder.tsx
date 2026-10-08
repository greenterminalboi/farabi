"use client";

// The ladder (FR-002, FR-005, FR-021, FR-023): rungs in order with state, level and a sparkline of
// level by round. Before start: edit, reorder, remove, add, then Start. After start: the same edits
// (open and solid rungs keep their order), a lesson link per rung, and setting a level by hand.
import { useState } from "react";
import { drillApi } from "@/lib/api";
import type { Drill, Rung } from "@/shared/schemas";
import { AiTag } from "./ElementText";
import { useDrillStore } from "./store";

type Draft = { id?: string; name: string; removed: boolean; state: Rung["state"] };

/** Level after each round, as a small line (FR-023). */
function Sparkline({ rung }: { rung: Rung }) {
  const points = rung.history.map((h) => h.level);
  if (points.length < 2) return null;
  const w = 64;
  const h = 16;
  const step = w / (points.length - 1);
  const d = points.map((p, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(h - ((p - 1) / 9) * h).toFixed(1)}`).join(" ");
  return (
    <svg className="drill-spark" width={w} height={h} aria-label={`Levels: ${points.join(", ")}`} role="img">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** The lesson written when a rung opened, reachable from the rung afterwards (FR-006). */
function lessonFor(drill: Drill, rungId: string) {
  return drill.rounds.flatMap((r) => r.lessons).find((l) => l.rungId === rungId) ?? null;
}

export function Ladder({ drill }: { drill: Drill }) {
  const run = useDrillStore((s) => s.run);
  const busy = useDrillStore((s) => s.busy);
  const showLesson = useDrillStore((s) => s.showLesson);
  const [editing, setEditing] = useState(!drill.started);
  const [draft, setDraft] = useState<Draft[] | null>(null);
  const live = drill.ladder.rungs.filter((r) => !r.removed);
  const rows: Draft[] = draft ?? live.map((r) => ({ id: r.id, name: r.name, removed: false, state: r.state }));
  const dirty = draft !== null;

  const update = (next: Draft[]) => setDraft(next);
  const move = (i: number, by: number) => {
    const next = [...rows];
    const [r] = next.splice(i, 1);
    next.splice(i + by, 0, r);
    update(next);
  };
  const save = async () => {
    const res = await run("ladder", () => drillApi.saveLadder(drill.drillId, rows.map((r) => ({ id: r.id, name: r.name, removed: r.removed }))));
    if (res) setDraft(null);
    return res;
  };
  const start = async () => {
    if (dirty && !(await save())) return;
    const res = await run("start", () => drillApi.start(drill.drillId));
    if (res) setEditing(false);
  };

  return (
    <aside className="drill-ladder" aria-label="Ladder">
      <div className="drill-ladder-head">
        <h2>Ladder</h2>
        {drill.ladder.provenance === "ai_suggested" && <AiTag title="Proposed by the AI; edit it before you start" />}
        {drill.started && (
          <button type="button" className="btn btn-small" onClick={() => (editing ? (setEditing(false), setDraft(null)) : setEditing(true))}>
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </div>
      <ol className="drill-rungs">
        {rows.map((r, i) => {
          const rung = r.id ? drill.ladder.rungs.find((x) => x.id === r.id) : undefined;
          const lesson = rung ? lessonFor(drill, rung.id) : null;
          const movable = !drill.started || r.state === "locked";
          return (
            <li key={r.id ?? `new-${i}`} className={`drill-rung state-${r.state}${r.removed ? " removed" : ""}`} data-testid={`drill-rung-${i}`}>
              {editing ? (
                <div className="drill-rung-edit">
                  <input
                    aria-label={`Rung ${i + 1} name`}
                    value={r.name}
                    maxLength={120}
                    disabled={r.removed}
                    onChange={(e) => update(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  />
                  <button type="button" className="btn btn-small" aria-label="Move up" disabled={!movable || i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button type="button" className="btn btn-small" aria-label="Move down" disabled={!movable || i === rows.length - 1} onClick={() => move(i, 1)}>
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => update(r.id ? rows.map((x, j) => (j === i ? { ...x, removed: !x.removed } : x)) : rows.filter((_, j) => j !== i))}
                  >
                    {r.removed ? "Keep" : "Remove"}
                  </button>
                </div>
              ) : (
                <div className="drill-rung-view">
                  <span className="drill-rung-name">
                    {i + 1}. {r.name}
                    {rung?.provenance === "ai_suggested" && <AiTag />}
                  </span>
                  {drill.started && rung && (
                    <span className="drill-rung-meta">
                      <span className={`drill-state state-${rung.state}`}>{rung.state}</span>
                      <span>L{rung.level}</span>
                      <Sparkline rung={rung} />
                      {lesson && (
                        <button type="button" className="toast-link" onClick={() => showLesson(lesson.id)}>
                          Lesson
                        </button>
                      )}
                      <select
                        aria-label={`Set level of ${r.name}`}
                        value=""
                        disabled={!!busy}
                        onChange={(e) => {
                          const [kind, v] = e.target.value.split(":");
                          void run("level", () => drillApi.setLevel(drill.drillId, rung.id, kind === "l" ? { level: Number(v) } : { state: v as Rung["state"] }));
                        }}
                      >
                        <option value="">Set…</option>
                        {Array.from({ length: 10 }, (_, n) => (
                          <option key={n} value={`l:${n + 1}`}>
                            Level {n + 1}
                          </option>
                        ))}
                        {(["locked", "open", "solid"] as const).map((s) => (
                          <option key={s} value={`s:${s}`}>
                            Mark {s}
                          </option>
                        ))}
                      </select>
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {editing && (
        <div className="drill-row">
          <button type="button" className="btn btn-small" onClick={() => update([...rows, { name: "New rung", removed: false, state: "locked" }])}>
            Add rung
          </button>
          {dirty && (
            <button type="button" className="btn btn-small" disabled={!!busy} onClick={() => void save()}>
              Save ladder
            </button>
          )}
        </div>
      )}
      {!drill.started && (
        <button type="button" className="btn btn-primary drill-start" data-testid="drill-start" disabled={!!busy || rows.every((r) => r.removed)} onClick={() => void start()}>
          {busy === "start" ? "Starting…" : "Start"}
        </button>
      )}
    </aside>
  );
}
