"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { termKey } from "@/lib/terms";
import type { Definition, DefinitionVersion } from "@/shared/schemas";
import { useDefinitionsStore } from "@/state/definitionsStore";
import { DefinitionBody } from "./TermCard";

const DRAFT_POLL_MS = 2000;

/** The Definitions tab (FR-030–FR-036): newest first, with a filter, confirm, edit and history. */
export function DefinitionsList() {
  const [definitions, setDefinitions] = useState<Definition[] | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const remember = useDefinitionsStore((s) => s.remember);

  const load = useCallback(
    () =>
      api.listDefinitions().then(
        ({ definitions: list }) => {
          setDefinitions(list);
          list.forEach(remember);
        },
        () => setError("Couldn't load definitions"),
      ),
    [remember],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Drafts arrive in the background; poll while any are being written.
  const drafting = definitions?.some((d) => d.status === "drafting") ?? false;
  useEffect(() => {
    if (!drafting) return;
    const id = setInterval(() => void load(), DRAFT_POLL_MS);
    return () => clearInterval(id);
  }, [drafting, load]);

  // Scroll to an entry linked as /definitions#<id>.
  useEffect(() => {
    if (!definitions) return;
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ block: "center" });
  }, [definitions]);

  const shown = useMemo(() => {
    const key = termKey(filter);
    return (definitions ?? []).filter((d) => !key || d.termKey.includes(key));
  }, [definitions, filter]);

  if (!definitions) return <div className="empty-state">{error ?? "Loading…"}</div>;
  return (
    <section className="definitions">
      <div className="definitions-head">
        <h1>Definitions</h1>
        <input
          type="search"
          aria-label="Filter definitions"
          placeholder="Filter terms…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {error && <p className="composer-error">{error}</p>}
      {definitions.length === 0 ? (
        <p className="muted">
          Highlight a word or phrase in any conversation and choose “Send to definitions”.
        </p>
      ) : (
        <ul className="definitions-list">
          {shown.map((d) => (
            <DefinitionCard key={d.id} definition={d} onChange={load} onError={setError} />
          ))}
        </ul>
      )}
    </section>
  );
}

function DefinitionCard({
  definition,
  onChange,
  onError,
}: {
  definition: Definition;
  onChange: () => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [general, setGeneral] = useState("");
  const [usage, setUsage] = useState("");
  const [history, setHistory] = useState<DefinitionVersion[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      setHistory(null);
      onChange();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="definition-card" id={definition.id} data-testid="definition-card">
      <DefinitionBody definition={definition} />
      {editing ? (
        <form
          className="definition-edit"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api.editDefinition(definition.id, general, usage);
              setEditing(false);
            });
          }}
        >
          <label>
            General
            <textarea value={general} onChange={(e) => setGeneral(e.target.value)} rows={2} />
          </label>
          <label>
            In your conversation
            <textarea value={usage} onChange={(e) => setUsage(e.target.value)} rows={2} />
          </label>
          <div className="definition-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !general.trim() || !usage.trim()}>
              Save
            </button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="definition-actions">
          {definition.status === "draft" && (
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => void act(() => api.confirmDefinition(definition.id))}>
              Confirm
            </button>
          )}
          {definition.current && (
            <button
              type="button"
              className="btn btn-small"
              disabled={busy}
              onClick={() => {
                setGeneral(definition.current!.generalText);
                setUsage(definition.current!.usageText);
                setEditing(true);
              }}
            >
              Edit
            </button>
          )}
          {definition.status === "failed" && (
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => void act(() => api.redraftDefinition(definition.id))}>
              Retry
            </button>
          )}
          <Link className="btn btn-small" href={`/n/${definition.source.nodeId}`}>
            Source
          </Link>
          <button
            type="button"
            className="btn btn-small"
            onClick={async () => setHistory(history ? null : (await api.getDefinition(definition.id)).versions)}
          >
            {history ? "Hide history" : "History"}
          </button>
        </div>
      )}
      {history && (
        <ol className="definition-history">
          {history.map((v) => (
            <li key={v.createdAt + v.provenance}>
              <span className="muted">
                {new Date(v.createdAt).toLocaleString()} · {v.provenance === "ai_suggested" ? "AI draft" : "Confirmed by you"}
              </span>
              <br />
              {v.generalText} {v.usageText}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}
