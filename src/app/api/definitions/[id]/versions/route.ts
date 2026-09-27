import { EditDefinitionRequest } from "@/shared/schemas";
import { saveDefinitionEdit } from "@/server/definitions/versions";
import { readJson, withApi } from "@/server/http/withApi";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { generalText, usageText } = await readJson(req, EditDefinitionRequest);
  return Response.json({ definition: await saveDefinitionEdit(id, generalText, usageText) }, { status: 201 });
});
