"use client";

// The completion offer (FR-032, FR-033): "Ladder complete" and up to 3 starting points from this
// drill's follow-ups and attached conversations. Drill this opens the create form prefilled; it
// creates nothing until the user does. Dismiss hides it for good.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { drillApi } from "@/lib/api";
import type { Drill } from "@/shared/schemas";
import { CreateDrillForm } from "./CreateDrillForm";
import { AiTag } from "./ElementText";
import { useDrillStore } from "./store";

export function OfferCards({ drill }: { drill: Drill }) {
  const run = useDrillStore((s) => s.run);
  const [picking, setPicking] = useState<string | null>(null);
  const router = useRouter();
  if (!drill.complete) return null;
  const offer = drill.offer && !drill.offer.dismissed ? drill.offer : null;
  const pick = offer?.candidates.find((c) => c.nodeId === picking);
  return (
    <section className="drill-complete" data-testid="drill-complete">
      <h3>Ladder complete</h3>
      <p className="drill-muted">Every rung is solid. Review rounds continue; add a rung to keep climbing.</p>
      {offer && (
        <>
          <div className="drill-row">
            <span className="drill-label">Drill on from here</span>
            <AiTag title="Chosen by the AI from your own follow-ups and attached conversations" />
            <button type="button" className="btn btn-small chrome-right" onClick={() => void run("dismiss", () => drillApi.dismissOffer(offer.offerId))}>
              Dismiss
            </button>
          </div>
          <div className="drill-offers">
            {offer.candidates.map((c, i) => (
              <div key={c.nodeId} className="drill-offer" data-testid={`drill-offer-${i}`}>
                <strong>{c.domain}</strong>
                <p className="drill-muted">{c.excerpt}</p>
                {offer.picked.includes(c.nodeId) ? (
                  <span className="drill-muted">Started</span>
                ) : (
                  <button type="button" className="btn btn-small" onClick={() => setPicking(c.nodeId)}>
                    Drill this
                  </button>
                )}
              </div>
            ))}
          </div>
          {pick && (
            <CreateDrillForm
              projectId={drill.projectId}
              initialDomain={pick.domain}
              sourceNodeId={pick.nodeId}
              offerId={offer.offerId}
              onCancel={() => setPicking(null)}
              onCreated={(d) => router.push(`/drill/${d.drillId}`)}
            />
          )}
        </>
      )}
    </section>
  );
}
