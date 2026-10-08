"use client";

// Branch, Define and Park on drill text (FR-026, research R14), on the drill screen's own DOM: the
// same selection mapping as the canvas toolbar, without the canvas engine. A branch is sent at once
// and lives on the canvas, leaving the drill node; the user stays here and a link appears under the
// problem. Hints and solutions are leaves: Define only. Rung names aren't element text (R13).
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Drill, Element } from "@/shared/schemas";
import { type SelectionAnchor, selectionToAnchor } from "@/canvas/text/selection";
import { drillApi } from "@/lib/api";
import { useDrillStore } from "./store";

type Action = "branch" | "park";
const LEAVES = new Set(["drill_hint", "drill_solution"]);

function elementsOf(drill: Drill): Map<string, Element> {
  const map = new Map<string, Element>();
  for (const r of drill.rounds) {
    for (const l of r.lessons) map.set(l.id, l);
    for (const p of r.problems) {
      map.set(p.element.id, p.element);
      if (p.hint) map.set(p.hint.id, p.hint);
      if (p.solution) map.set(p.solution.id, p.solution);
      for (const a of p.attempts) {
        map.set(a.attempt.id, a.attempt);
        if (a.verdict) map.set(a.verdict.id, a.verdict);
      }
    }
  }
  return map;
}

export function DrillSelectionToolbar({ root }: { root: React.RefObject<HTMLElement | null> }) {
  const [current, setCurrent] = useState<{ anchor: SelectionAnchor; range: Range } | null>(null);
  const [form, setForm] = useState<{ action: Action; question: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const formOpen = useRef(false);

  useEffect(() => {
    const update = () => {
      if (formOpen.current) return;
      const sel = document.getSelection();
      const drill = useDrillStore.getState().drill;
      if (!sel || sel.rangeCount === 0 || !drill || !root.current) return setCurrent(null);
      const range = sel.getRangeAt(0);
      if (!root.current.contains(range.commonAncestorContainer)) return setCurrent(null);
      const map = elementsOf(drill);
      const a = selectionToAnchor(range, (id) => map.get(id)?.text ?? undefined);
      setCurrent(a ? { anchor: a, range } : null);
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [root]);

  const close = () => {
    formOpen.current = false;
    setForm(null);
    setCurrent(null);
    document.getSelection()?.removeAllRanges();
  };
  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(null), 4000);
  };
  const refresh = async () => {
    const drill = useDrillStore.getState().drill;
    if (drill) useDrillStore.getState().set((await drillApi.get(drill.drillId)).drill);
  };

  async function act(fn: () => Promise<string>) {
    setBusy(true);
    try {
      const message = await fn();
      close();
      flash(message);
      await refresh();
    } catch (err) {
      flash(err instanceof Error ? err.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  }

  const anchor = current?.anchor ?? null;
  const drill = useDrillStore((s) => s.drill);
  const el = anchor && drill ? elementsOf(drill).get(anchor.nodeId) : undefined;
  const leaf = el ? LEAVES.has(el.kind) : true;
  const rect = current ? current.range.getBoundingClientRect() : null;
  const pos = rect ? { left: Math.max(130, Math.min(rect.left + rect.width / 2, window.innerWidth - 130)), top: rect.top - 8 } : null;
  const span = anchor ? { start: anchor.start, end: anchor.end, text: anchor.text } : null;

  return (
    <>
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {anchor && span && pos && form && (
        <form
          className="highlight-toolbar highlight-form"
          style={{ ...pos, position: "fixed" }}
          onSubmit={(e) => {
            e.preventDefault();
            const question = form.question.trim();
            if (form.action === "branch") {
              void act(async () => {
                const { edge } = await api.branch(anchor.nodeId, span);
                await api.sendUnsent(edge.id, question || anchor.text);
                return "Branched onto the canvas";
              });
            } else {
              void act(async () => {
                await api.park(anchor.nodeId, span, question || null);
                return "Parked";
              });
            }
          }}
        >
          <input
            autoFocus
            aria-label="Your question (optional)"
            placeholder="Your question (optional)"
            value={form.question}
            disabled={busy}
            onChange={(e) => setForm({ ...form, question: e.target.value })}
          />
          <button type="submit" disabled={busy}>
            {form.action === "branch" ? "Branch" : "Park"}
          </button>
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
        </form>
      )}
      {anchor && span && pos && !form && (
        <div
          className="highlight-toolbar"
          role="toolbar"
          aria-label="Highlight actions"
          style={{ ...pos, position: "fixed" }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const { definition, created } = await api.captureDefinition({ nodeId: anchor.nodeId, ...span });
                return created ? `Added “${definition.term}” to Definitions` : `“${definition.term}” is already in Definitions`;
              })
            }
          >
            <span aria-hidden="true">📖</span> Define
          </button>
          {!leaf && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  formOpen.current = true;
                  setForm({ action: "branch", question: "" });
                }}
              >
                <span aria-hidden="true">⑂</span> Branch
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  formOpen.current = true;
                  setForm({ action: "park", question: "" });
                }}
              >
                <span aria-hidden="true">🅿</span> Park
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
