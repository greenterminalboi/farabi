import Link from "next/link";
import type { MapPipe, SourcePart } from "@/shared/schemas";

const READS: Record<SourcePart, string> = {
  summary: "reads the summary",
  conversation: "reads the conversation",
  anchor: "reads the highlighted passage",
};

const STATE = { proposed: "Proposed", confirmed: "Confirmed", rejected: "Rejected" } as const;

/**
 * What a pipe records: the function and version that made its output, what it reads, how many
 * versions exist and the review state (Feature 9, FR-014, FR-017). Opens nothing by itself.
 */
export function PipeCard({
  pipe,
  outputLabel,
  versionCount,
  stale,
  style,
  onClose,
}: {
  pipe: MapPipe;
  outputLabel: string;
  versionCount: number;
  stale: boolean;
  style?: React.CSSProperties;
  onClose?: () => void;
}) {
  return (
    <div className="pipe-card" data-testid="pipe-card" style={style} role="dialog" aria-label="Pipe">
      <div className="pipe-card-head">
        <span className="ai-tag">AI</span>
        <strong data-testid="pipe-function">
          {pipe.functionName} v{pipe.functionVersion}
        </strong>
        {onClose && (
          <button type="button" className="btn btn-small" aria-label="Close" onClick={onClose}>
            ×
          </button>
        )}
      </div>
      <p className="muted" data-testid="pipe-reads">
        {READS[pipe.reads]}
      </p>
      <p>
        <span className={`review-chip review-${pipe.state}`} data-testid="pipe-state">
          {STATE[pipe.state]}
        </span>{" "}
        <span className="muted" data-testid="pipe-versions">
          {versionCount} {versionCount === 1 ? "version" : "versions"}
          {stale ? " · stale" : ""}
        </span>
      </p>
      <p className="pipe-card-links">
        <Link href={`/n/${pipe.inputNodeId}`}>Open input</Link>
        <Link href={`/n/${pipe.outputNodeId}`}>Open {outputLabel.toLowerCase()}</Link>
      </p>
    </div>
  );
}
