import { ProblemEventBody } from "@/shared/schemas";
import { readJson } from "@/server/http/withApi";
import { recordProblemEvent } from "@/server/drill/events";
import { drillResponse, withDrillApi } from "@/server/drill/http";

type Ctx = { params: Promise<{ problemId: string }> };

/** Hint, reveal, skip or flag (FR-014, FR-018). No AI call (R9). */
export const POST = withDrillApi(async (req: Request, { params }: Ctx) => {
  const { problemId } = await params;
  return drillResponse(await recordProblemEvent(problemId, await readJson(req, ProblemEventBody)));
});
