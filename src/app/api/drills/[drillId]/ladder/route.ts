import { SaveLadderBody } from "@/shared/schemas";
import { readJson } from "@/server/http/withApi";
import { drillResponse, withDrillApi } from "@/server/drill/http";
import { saveLadder } from "@/server/drill/ladder";

type Ctx = { params: Promise<{ drillId: string }> };

/** A new ladder version (FR-002). No AI call. */
export const POST = withDrillApi(async (req: Request, { params }: Ctx) => {
  const { drillId } = await params;
  const { rungs } = await readJson(req, SaveLadderBody);
  await saveLadder(drillId, rungs);
  return drillResponse(drillId);
});
