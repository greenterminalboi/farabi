import { ParkedQuestionRequest } from "@/shared/schemas";
import { readJson, withApi } from "@/server/http/withApi";
import { setParkedQuestion } from "@/server/parked/park";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { question } = await readJson(req, ParkedQuestionRequest);
  return Response.json(await setParkedQuestion(id, question));
});
