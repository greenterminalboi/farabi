// The drill screen (Feature 12, FR-004): its own page, not the canvas (research R14).
import { DrillScreen } from "@/drill/DrillScreen";

export const metadata = { title: "Drill · Farabi" };
export const dynamic = "force-dynamic";

export default async function DrillPage({ params }: { params: Promise<{ drillId: string }> }) {
  const { drillId } = await params;
  return <DrillScreen drillId={drillId} />;
}
