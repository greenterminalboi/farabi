import type { ZodType } from "zod";
import {
  type Anchor,
  BranchResponse,
  CaptureResponse,
  CreateTreeResponse,
  DefinitionDetailResponse,
  DefinitionResponse,
  DefinitionsResponse,
  ErrorBody,
  ForestResponse,
  NodeResponse,
  NodeView,
  OriginResponse,
  RefreshResponse,
  RefreshStaleResponse,
  RegenerateResponse,
  RetryResponse,
  SendMessageResponse,
  StopResponse,
  TermIndexResponse,
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
  setTreeOrigin: (treeId: string, x: number, y: number, byUser = false) =>
    request("PUT", `/api/trees/${treeId}/origin`, OriginResponse, { x, y, byUser }),
  setEdgeLabel: (nodeId: string, text: string | null) =>
    request("PUT", `/api/nodes/${nodeId}/edge-label`, NodeResponse, { text }),
  setNodePosition: (nodeId: string, x: number, y: number) =>
    request("PUT", `/api/nodes/${nodeId}/position`, NodeResponse, { x, y }),
  getNode: (nodeId: string) => request("GET", `/api/nodes/${nodeId}`, NodeView),
  branch: (nodeId: string, anchor: Anchor) =>
    request("POST", `/api/nodes/${nodeId}/branches`, BranchResponse, anchor),
  sendMessage: (nodeId: string, content: string) =>
    request("POST", `/api/nodes/${nodeId}/messages`, SendMessageResponse, { content }),
  stop: (messageId: string) => request("POST", `/api/messages/${messageId}/stop`, StopResponse, {}),
  retry: (messageId: string) =>
    request("POST", `/api/messages/${messageId}/retry`, RetryResponse, {}),
  regenerate: (messageId: string) =>
    request("POST", `/api/messages/${messageId}/regenerate`, RegenerateResponse, {}),
  refreshStaleSummaries: () =>
    request("POST", "/api/summaries/refresh-stale", RefreshStaleResponse, {}),
  captureDefinition: (body: { nodeId: string; messageId: string; start: number; end: number; text: string }) =>
    request("POST", "/api/definitions", CaptureResponse, body),
  listDefinitions: () => request("GET", "/api/definitions", DefinitionsResponse),
  getTermIndex: () => request("GET", "/api/definitions?index=1", TermIndexResponse),
  getDefinition: (id: string) => request("GET", `/api/definitions/${id}`, DefinitionDetailResponse),
  confirmDefinition: (id: string) => request("POST", `/api/definitions/${id}/confirm`, DefinitionResponse, {}),
  editDefinition: (id: string, generalText: string, usageText: string) =>
    request("POST", `/api/definitions/${id}/versions`, DefinitionResponse, { generalText, usageText }),
  redraftDefinition: (id: string) => request("POST", `/api/definitions/${id}/redraft`, RefreshResponse, {}),
  refreshSummary: (nodeId: string) =>
    request("POST", `/api/nodes/${nodeId}/summary/refresh`, RefreshResponse, {}),
};
