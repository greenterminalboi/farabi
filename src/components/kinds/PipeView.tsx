"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { findKind } from "@/shared/kinds";
import type { PipeViewResponse } from "@/shared/schemas";
import { PipeCard } from "./PipeCard";

/** A pipe opened on its own (Feature 9, view "pipe"). */
export function PipeView({ nodeId }: { nodeId: string }) {
  const [view, setView] = useState<PipeViewResponse | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    api.getPipeView(nodeId).then(setView, () => setError(true));
  }, [nodeId]);
  if (!view) return <div className="empty-state">{error ? "Couldn't load this pipe" : "Loading…"}</div>;
  return (
    <section className="pipe-view">
      <PipeCard
        pipe={view.pipe}
        outputLabel={findKind(view.output.kind)?.label ?? "output"}
        versionCount={view.versionCount}
        stale={view.stale}
      />
    </section>
  );
}
