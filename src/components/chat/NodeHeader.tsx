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

export function NodeHeader({ summary }: { summary: Summary }) {
  return (
    <div className="node-header" data-testid="node-header">
      <SummaryLabel summary={summary} />
    </div>
  );
}
