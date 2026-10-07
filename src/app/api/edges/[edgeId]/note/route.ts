import { NoteRequest } from "@/shared/schemas";
import { setNote } from "@/server/graph/notes";
import { readJson, withApi } from "@/server/http/withApi";

type Ctx = { params: Promise<{ edgeId: string }> };

/** Sets, changes or clears an edge's note; every call appends a version (FR-040). */
export const PUT = withApi(async (req: Request, { params }: Ctx) => {
  const { edgeId } = await params;
  const { text } = await readJson(req, NoteRequest);
  return Response.json({ edge: await setNote(edgeId, text) });
});
