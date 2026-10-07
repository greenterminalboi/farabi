import { judgeAgain } from "@/server/drill/attempts";
import { drillResponse, withDrillApi } from "@/server/drill/http";

type Ctx = { params: Promise<{ attemptId: string }> };

/** Judges an attempt whose verdict failed. 409 `already_judged` if it has one. */
export const POST = withDrillApi(async (_req: Request, { params }: Ctx) => {
  const { attemptId } = await params;
  const { drillId, roundEnded } = await judgeAgain(attemptId);
  return drillResponse(drillId, { roundEnded });
});
