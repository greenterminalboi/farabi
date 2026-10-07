"use client";

/** An empty project: an invitation, with the composer below it targeting a new tree (story 1). */
export function EmptyState() {
  return (
    <div className="canvas-empty" data-testid="empty-state">
      <h1>Ask anything to start a tree</h1>
      <p>Highlight any words in a reply to branch off on a tangent.</p>
    </div>
  );
}
