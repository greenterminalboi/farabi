import { withApi } from "@/server/http/withApi";
import { hostInfo } from "@/server/host/info";

export const GET = withApi(async () => Response.json(hostInfo()));
