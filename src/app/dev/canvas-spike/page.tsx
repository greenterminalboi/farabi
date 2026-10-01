import { notFound } from "next/navigation";
import { CanvasSpike } from "./CanvasSpike";

export const dynamic = "force-dynamic";

/**
 * Milestone M0 (research R17): 5,000 synthetic elements through the real text layer, to prove
 * selectable text holds 60 fps before anything else is built. Test hooks only; removed after M0.
 */
export default async function CanvasSpikePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  if (process.env.FARABI_TEST_HOOKS !== "1") notFound();
  const params = await searchParams;
  const n = Number(params.n ?? 5000);
  const total = params.total ? Number(params.total) : undefined;
  const floor = params.floor ? Number(params.floor) : undefined;
  return <CanvasSpike n={Number.isFinite(n) ? n : 5000} willChange={params.willChange === "1"} total={total} floor={floor} />;
}
