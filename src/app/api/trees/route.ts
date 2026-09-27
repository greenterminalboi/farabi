import { createRootTree } from "@/server/forest/trees";
import { withApi } from "@/server/http/withApi";

export const POST = withApi(async () => Response.json(await createRootTree(), { status: 201 }));
