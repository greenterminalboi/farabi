import { SetLevelBody } from "@/shared/schemas";
import { readJson } from "@/server/http/withApi";
import { drillResponse, withDrillApi } from "@/server/drill/http";
import { setLevel } from "@/server/drill/levels";

type Ctx = { params: Promise<{ drillId: string; rungId: string }> };

/** Sets a rung's level or state by hand (FR-021). */
export const POST = withDrillApi(async (req: Request, { params }: Ctx) => {
  const { drillId, rungId } = await params;
  await setLevel(drillId, rungId, await readJson(req, SetLevelBody));
  return drillResponse(drillId);
});
