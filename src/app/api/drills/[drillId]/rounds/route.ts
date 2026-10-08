import { drillResponse, withDrillApi } from "@/server/drill/http";
import { generateRound } from "@/server/drill/rounds";

type Ctx = { params: Promise<{ drillId: string }> };

/** Generates the next round when none is open: the retry after a failed generation. */
export const POST = withDrillApi(async (_req: Request, { params }: Ctx) => {
  const { drillId } = await params;
  await generateRound(drillId);
  return drillResponse(drillId);
});
