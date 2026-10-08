import { providerReady } from "@/server/ai";
import { waitFor } from "@/server/answers/generation";
import { withApi } from "@/server/http/withApi";
import { fireParked } from "@/server/parked/fire";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withApi(async (req: Request, { params }: Ctx) => {
  await providerReady();
  const { id } = await params;
  const result = await fireParked(id);
  // ?wait=1 answers only once the reply has ended (tests and scripts).
  if (result.kind === "sent" && new URL(req.url).searchParams.get("wait") === "1") {
    result.answer = await waitFor(result.answer.id);
  }
  return Response.json(result, { status: 201 });
});
