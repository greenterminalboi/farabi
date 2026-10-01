"use client";

import { useState } from "react";
import { FunctionMenu } from "@/components/kinds/FunctionMenu";
import type { Summary } from "@/shared/schemas";

/** Current label for a node; AI summaries are always marked as AI-generated (FR-014). */
export function SummaryLabel({ summary }: { summary: Summary }) {
  if (summary.kind === "placeholder") {
    return <span className="placeholder">{summary.text}</span>;
  }
  return (
    <span className="summary" title="AI-generated summary">
      <span className="ai-tag">AI</span>
      {summary.text}
    </span>
  );
}

export function NodeHeader({
  nodeId,
  summary,
  showSuggestions,
  onToggleSuggestions,
}: {
  nodeId: string;
  summary: Summary;
  showSuggestions: boolean;
  onToggleSuggestions: () => void;
}) {
  const [functionsOpen, setFunctionsOpen] = useState(false);
  return (
    <div className="node-header" data-testid="node-header">
      <SummaryLabel summary={summary} />
      {/* Suggested underlines can always be turned off (Feature 5, FR-012, Article IV). */}
      <button
        type="button"
        className="btn btn-small suggestions-toggle"
        data-testid="suggestions-toggle"
        aria-pressed={showSuggestions}
        title="Underline bold text in replies as places to branch"
        onClick={onToggleSuggestions}
      >
        Suggestions
      </button>
      {/* Node functions run only when the user picks one (Feature 9, FR-009, FR-024). */}
      <span className="node-functions" data-function-menu-anchor>
        <button
          type="button"
          className="btn btn-small"
          data-testid="node-functions-button"
          aria-expanded={functionsOpen}
          onClick={() => setFunctionsOpen((open) => !open)}
        >
          Functions
        </button>
        {functionsOpen && (
          <FunctionMenu key={nodeId} nodeId={nodeId} showOpenLink onClose={() => setFunctionsOpen(false)} />
        )}
      </span>
    </div>
  );
}
