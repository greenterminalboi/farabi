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
  summary,
  showSuggestions,
  onToggleSuggestions,
}: {
  summary: Summary;
  showSuggestions: boolean;
  onToggleSuggestions: () => void;
}) {
  return (
    <div className="node-header" data-testid="node-header">
      <SummaryLabel summary={summary} />
      {/* Suggested underlines can always be turned off (Feature 5, FR-012, Article IV). */}
      <button
        type="button"
        className="btn btn-small suggestions-toggle"
        data-testid="suggestions-toggle"
        aria-pressed={showSuggestions}
        title="Show suggested places to branch"
        onClick={onToggleSuggestions}
      >
        Suggestions
      </button>
    </div>
  );
}
