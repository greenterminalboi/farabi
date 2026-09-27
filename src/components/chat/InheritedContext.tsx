import Link from "next/link";
import type { Anchor, InheritedContextEntry } from "@/shared/schemas";

/** Design can flip this default (FR-033 leaves collapsed vs. inline to design). */
export const INHERITED_CONTEXT_DEFAULT_COLLAPSED = true;

type Props = { anchor: Anchor; parentId: string; inherited: InheritedContextEntry[] };

/**
 * Shows what the AI in this branch knows from its parent (FR-005, FR-033). Read-only and set
 * apart; messages carry no data-message-id, so they can't be branched from here.
 */
export function InheritedContext({ anchor, parentId, inherited }: Props) {
  const count = inherited.reduce((n, e) => n + e.messages.length, 0);
  return (
    <>
      <blockquote className="anchor-quote" data-testid="anchor-quote">
        “{anchor.text}”
        <Link className="back" href={`/n/${parentId}`}>
          Back to parent
        </Link>
      </blockquote>
      {count > 0 && (
        <details className="inherited" open={!INHERITED_CONTEXT_DEFAULT_COLLAPSED} data-testid="inherited-context">
          <summary>Context from earlier conversation ({count} messages, read-only)</summary>
          <div className="inherited-messages">
            {inherited.flatMap((entry) =>
              entry.messages.map((m) => (
                <div key={m.id} className="inherited-message">
                  <strong>{m.role === "ai" ? "AI" : "You"}:</strong>{" "}
                  <span style={{ whiteSpace: "pre-wrap" }}>{m.content}</span>
                </div>
              )),
            )}
          </div>
        </details>
      )}
    </>
  );
}
