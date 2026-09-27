import type { ZodType } from "zod";
import {
  type Anchor,
  BranchResponse,
  CreateTreeResponse,
  ErrorBody,
  ForestResponse,
  NodeView,
  OriginResponse,
  RefreshResponse,
  RefreshStaleResponse,
  RegenerateResponse,
  RetryResponse,
  SendMessageResponse,
} from "@/shared/schemas";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, schema: ZodType<T>, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const parsed = ErrorBody.safeParse(json);
    const code = parsed.success ? parsed.data.error.code : "http_error";
    const message = parsed.success ? parsed.data.error.message : `HTTP ${res.status}`;
    throw new ApiError(res.status, code, message, json);
  }
  return schema.parse(json);
}

export const api = {
  getForest: () => request("GET", "/api/forest", ForestResponse),
  createTree: () => request("POST", "/api/trees", CreateTreeResponse, {}),
  setTreeOrigin: (treeId: string, x: number, y: number) =>
    request("PUT", `/api/trees/${treeId}/origin`, OriginResponse, { x, y }),
  getNode: (nodeId: string) => request("GET", `/api/nodes/${nodeId}`, NodeView),
  branch: (nodeId: string, anchor: Anchor) =>
    request("POST", `/api/nodes/${nodeId}/branches`, BranchResponse, anchor),
  sendMessage: (nodeId: string, content: string) =>
    request("POST", `/api/nodes/${nodeId}/messages`, SendMessageResponse, { content }),
  retry: (messageId: string) =>
    request("POST", `/api/messages/${messageId}/retry`, RetryResponse, {}),
  regenerate: (messageId: string) =>
    request("POST", `/api/messages/${messageId}/regenerate`, RegenerateResponse, {}),
  refreshStaleSummaries: () =>
    request("POST", "/api/summaries/refresh-stale", RefreshStaleResponse, {}),
  refreshSummary: (nodeId: string) =>
    request("POST", `/api/nodes/${nodeId}/summary/refresh`, RefreshResponse, {}),
};
