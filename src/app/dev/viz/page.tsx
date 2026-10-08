// The visualization engine's preview page (feature 014, US4, FR-019). Unlinked; writes nothing.
import { VizPreview } from "./VizPreview";

export const metadata = { title: "Visualizations · Farabi" };

export default async function VizDevPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { scene } = await searchParams;
  return <VizPreview initialId={typeof scene === "string" ? scene : undefined} />;
}
