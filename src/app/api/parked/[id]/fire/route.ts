import { withApi } from "@/server/http/withApi";
import { waitFor } from "@/server/messages/generation";
import { fireParked } from "@/server/parked/fire";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const result = await fireParked(id);
  // ?wait=1 answers only once the reply has ended (tests and scripts).
  if (result.kind === "sent" && new URL(req.url).searchParams.get("wait") === "1") {
    result.aiMessage = await waitFor(result.aiMessage.id);
  }
  return Response.json(result, { status: 201 });
});
