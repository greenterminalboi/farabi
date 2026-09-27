"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Project } from "@/shared/schemas";

type State = { projects: Project[]; trashed: Project[]; currentId: string };

/**
 * Top-bar project menu (Feature 4): open, create, move to trash, restore. Everything autosaves,
 * so there is no Save. After a switch the page reloads, so every view starts from the new project.
 */
export function ProjectMenu() {
  const [state, setState] = useState<State | null>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = () => api.listProjects().then(setState, () => setError("Couldn't load projects"));
  useEffect(() => {
    void load();
  }, []);

  // Close when clicking outside or pressing Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // A full page load on purpose (plan D2): the map renderer, term index and last conversation are
  // client state from the old project, and a reload resets them all.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  const reloadInto = () => window.location.assign("/");

  async function act(fn: () => Promise<unknown>, reload: boolean) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (reload) reloadInto();
      else await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const current = state?.projects.find((p) => p.id === state.currentId);

  return (
    <div className="project-menu" ref={rootRef}>
      <button
        type="button"
        className="btn project-menu-button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => {
          setOpen(!open);
          setConfirmTrash(false);
          setCreating(false);
        }}
      >
        <span aria-hidden="true">🗂</span> {current?.name ?? "Projects"} <span aria-hidden="true">▾</span>
      </button>
      {open && state && (
        <div className="project-menu-panel" role="dialog" aria-label="Projects">
          <div className="project-menu-heading">Projects</div>
          <ul className="project-list">
            {state.projects.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="project-item"
                  aria-current={p.id === state.currentId ? "true" : undefined}
                  disabled={busy}
                  onClick={() => (p.id === state.currentId ? setOpen(false) : void act(() => api.openProject(p.id), true))}
                >
                  {p.id === state.currentId ? "✓ " : ""}
                  {p.name}
                </button>
              </li>
            ))}
          </ul>

          {creating ? (
            <form
              className="project-create"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) void act(() => api.createProject(name), true);
              }}
            >
              <input
                aria-label="Project name"
                placeholder="Project name"
                value={name}
                maxLength={80}
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
              <button type="submit" className="btn btn-primary btn-small" disabled={busy || !name.trim()}>
                Create
              </button>
            </form>
          ) : (
            <button type="button" className="btn btn-small" onClick={() => setCreating(true)}>
              + New project
            </button>
          )}

          {current &&
            (confirmTrash ? (
              <div className="project-trash-confirm">
                <span>Move “{current.name}” to the trash? It can be restored.</span>
                <button type="button" className="btn btn-small btn-danger" disabled={busy} onClick={() => void act(() => api.trashProject(current.id), true)}>
                  Move to trash
                </button>
                <button type="button" className="btn btn-small" onClick={() => setConfirmTrash(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" className="btn btn-small" onClick={() => setConfirmTrash(true)}>
                Move “{current.name}” to trash…
              </button>
            ))}

          {state.trashed.length > 0 && (
            <>
              <div className="project-menu-heading">Trash</div>
              <ul className="project-list">
                {state.trashed.map((p) => (
                  <li key={p.id} className="project-trashed">
                    <span>{p.name}</span>
                    <button type="button" className="btn btn-small" disabled={busy} onClick={() => void act(() => api.restoreProject(p.id), false)}>
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {error && (
            <p className="feedback-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
