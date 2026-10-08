"use client";

// Creating a drill (FR-001): the user types a domain; the AI proposes a ladder. On failure the typed
// text stays, with Retry (Story 1 AS4). An offered starting point arrives prefilled (FR-033).
import { useState } from "react";
import { drillApi, ApiError } from "@/lib/api";
import type { Drill } from "@/shared/schemas";

type Props = {
  projectId: string;
  initialDomain?: string;
  sourceNodeId?: string;
  offerId?: string;
  onCreated: (drill: Drill) => void;
  onCancel?: () => void;
};

export function CreateDrillForm({ projectId, initialDomain = "", sourceNodeId, offerId, onCreated, onCancel }: Props) {
  const [domain, setDomain] = useState(initialDomain);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!domain.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { drill } = await drillApi.create({ projectId, domain, sourceNodeId, offerId });
      onCreated(drill);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach Farabi. Check that it's running.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="drill-create"
      data-testid="drill-create"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor="drill-domain">What do you want to drill?</label>
      <input
        id="drill-domain"
        data-testid="drill-domain"
        autoFocus
        maxLength={300}
        placeholder="e.g. Python dictionaries"
        value={domain}
        disabled={busy}
        onChange={(e) => setDomain(e.target.value)}
      />
      {sourceNodeId && <p className="drill-muted">Suggested by the AI from your conversation; edit it before the ladder is proposed.</p>}
      <div className="drill-row">
        <button type="submit" className="btn btn-primary" disabled={busy || !domain.trim()}>
          {busy ? "Proposing a ladder…" : error ? "Retry" : "Create drill"}
        </button>
        {onCancel && (
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {error && (
        <p className="drill-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
