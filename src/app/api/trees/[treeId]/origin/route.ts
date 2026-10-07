import { z } from "zod";
import { OriginRequest } from "@/shared/schemas";
import { setTreeOrigin } from "@/server/graph/positions";
import { readJson, withApi } from "@/server/http/withApi";

type Ctx = { params: Promise<{ treeId: string }> };

const Body = OriginRequest.extend({ byUser: z.boolean().optional() });

/** Moves a tree; a user's drag marks it placed (FR-037, FR-038). */
export const PUT = withApi(async (req: Request, { params }: Ctx) => {
  const { treeId } = await params;
  const { x, y, byUser } = await readJson(req, Body);
  return Response.json({ tree: await setTreeOrigin(treeId, x, y, byUser ?? true) });
});
