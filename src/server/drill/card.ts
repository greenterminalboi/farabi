// The drill card on the canvas (FR-024, contracts/drill-ui.md): the domain, the newest open rung
// and its level or "Complete", and "from ‹parent›" for a drill picked from another's offer (R12).
import type { Element } from "@/shared/schemas";
import { loadDrillSummaries } from "./load";

type Card = NonNullable<Element["card"]>;

/** Cards of a project's drills, by drill node id. */
export async function drillCards(projectId: string): Promise<Map<string, Card>> {
  const summaries = await loadDrillSummaries(projectId);
  return new Map(
    summaries.map((s) => {
      const progress = !s.started
        ? "Not started"
        : s.complete
          ? "Complete"
          : s.newestOpen
            ? `Rung ${s.newestOpen.number}: ${s.newestOpen.name} · level ${s.newestOpen.level}`
            : "No open rung";
      const lines = [progress, ...(s.parentDrill ? [`from ${s.parentDrill.domain}`] : [])];
      return [s.nodeId, { title: s.domain, lines, href: `/drill/${s.drillId}` }];
    }),
  );
}
