import { providerReady } from "@/server/ai";
import { AttemptBody } from "@/shared/schemas";
import { readJson } from "@/server/http/withApi";
import { submitAttempt } from "@/server/drill/attempts";
import { drillResponse, withDrillApi } from "@/server/drill/http";

type Ctx = { params: Promise<{ problemId: string }> };

/** An attempt, then its verdict. If judging fails the attempt stays: 503 with its id. */
export const POST = withDrillApi(async (req: Request, { params }: Ctx) => {
  await providerReady();
  const { problemId } = await params;
  const { text } = await readJson(req, AttemptBody);
  const { drillId, roundEnded } = await submitAttempt(problemId, text);
  return drillResponse(drillId, { roundEnded }, 201);
});
