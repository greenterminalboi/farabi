import { providerReady } from "@/server/ai";
import { drillResponse, withDrillApi } from "@/server/drill/http";
import { startDrill } from "@/server/drill/start";

type Ctx = { params: Promise<{ drillId: string }> };

/** Starts the drill and generates round 1; a failed round is returned for the retry. */
export const POST = withDrillApi(async (_req: Request, { params }: Ctx) => {
  await providerReady();
  const { drillId } = await params;
  const nextRoundError = await startDrill(drillId);
  return drillResponse(drillId, nextRoundError ? { nextRoundError } : {});
});
