import { OverrideBody } from "@/shared/schemas";
import { readJson } from "@/server/http/withApi";
import { drillResponse, withDrillApi } from "@/server/drill/http";
import { overrideVerdict } from "@/server/drill/overrides";

type Ctx = { params: Promise<{ verdictId: string }> };

/** The user's verdict; it counts, and the AI's is kept (FR-017, FR-021). */
export const POST = withDrillApi(async (req: Request, { params }: Ctx) => {
  const { verdictId } = await params;
  const { verdict } = await readJson(req, OverrideBody);
  return drillResponse(await overrideVerdict(verdictId, verdict), {}, 201);
});
