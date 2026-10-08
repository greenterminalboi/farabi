"use client";

// The drill's pieces on the canvas page (contracts/drill-ui.md): the New drill form, "Back to drill"
// after following a link from the drill screen, and pick mode for attaching a conversation (FR-031).
import { useRouter } from "next/navigation";
import { ApiError, drillApi } from "@/lib/api";
import { useCanvasStore } from "@/canvas/store";
import { CreateDrillForm } from "./CreateDrillForm";
import { useState } from "react";

/** New drill, opened from the canvas menu; it stays on the canvas until the drill exists. */
export function NewDrillOverlay({ onClose }: { onClose: () => void }) {
  const projectId = useCanvasStore((s) => s.projectId);
  const router = useRouter();
  if (!projectId) return null;
  return (
    <div className="drill-overlay" data-overlay role="dialog" aria-label="New drill">
      <CreateDrillForm projectId={projectId} onCancel={onClose} onCreated={(d) => router.push(`/drill/${d.drillId}`)} />
    </div>
  );
}

/** Only links back to a drill screen are followed. */
const safeDrillHref = (href: string) => (/^\/drill\/[0-9a-f-]{36}(#[0-9a-f-]{36})?$/i.test(href) ? href : null);

export function BackToDrill({ href }: { href: string }) {
  const target = safeDrillHref(href);
  if (!target) return null;
  return (
    <a className="btn btn-small drill-back" data-overlay href={target} data-testid="back-to-drill">
      ← Back to drill
    </a>
  );
}

/** Pick mode: focus a node, then Attach; the drill reads its root-to-node path from then on. */
export function AttachBanner({ drillId, returnTo }: { drillId: string; returnTo: string | null }) {
  const focusId = useCanvasStore((s) => s.focusId);
  const focused = useCanvasStore((s) => (s.focusId ? s.elements.get(s.focusId) : undefined));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const back = (returnTo && safeDrillHref(returnTo)) ?? `/drill/${drillId}`;
  const usable = focused && focused.text !== null && !focused.kind.startsWith("drill");
  return (
    <div className="drill-attach-banner" data-overlay data-testid="drill-attach-banner">
      <span>{usable ? `Attach “${(focused.text ?? "").slice(0, 60)}…” and the conversation above it?` : "Click a message or answer to attach its conversation to the drill."}</span>
      <button
        type="button"
        className="btn btn-small btn-primary"
        disabled={!usable || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await drillApi.attach(drillId, focusId!, "attach");
            window.location.assign(back);
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Couldn't attach it");
            setBusy(false);
          }
        }}
      >
        Attach
      </button>
      <a className="btn btn-small" href={back}>
        Cancel
      </a>
      {error && <span className="drill-error">{error}</span>}
    </div>
  );
}
