import type { ZodType } from "zod";
import {
  type Anchor,
  BranchResponse,
  CaptureResponse,
  CreateTreeResponse,
  DiscardParkedResponse,
  FireParkedResponse,
  DefinitionDetailResponse,
  DefinitionResponse,
  DefinitionsResponse,
  ErrorBody,
  FeedbackItemResponse,
  type FeedbackCreateFields,
  FeedbackListResponse,
  ProjectResponse,
  ProjectsResponse,
  TrashProjectResponse,
  ForestResponse,
  NodeResponse,
  NodeView,
  OriginResponse,
  ParkedResponse,
  RefreshResponse,
  RefreshStaleResponse,
  RegenerateResponse,
  RetryResponse,
  type SaveSettingsBody,
  SendMessageResponse,
  SettingsResponse,
  StopResponse,
  SuggestionsResponse,
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
  const isForm = body instanceof FormData;
  const res = await fetch(path, {
    method,
    headers: body === undefined || isForm ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
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
  park: (nodeId: string, anchor: Anchor, question: string | null) =>
    request("POST", `/api/nodes/${nodeId}/parked`, ParkedResponse, { ...anchor, question }),
  setParkedQuestion: (id: string, question: string | null) =>
    request("POST", `/api/parked/${id}/question`, ParkedResponse, { question }),
  discardParked: (id: string) => request("POST", `/api/parked/${id}/discard`, DiscardParkedResponse, {}),
  fireParked: (id: string) => request("POST", `/api/parked/${id}/fire`, FireParkedResponse, {}),
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
  listProjects: () => request("GET", "/api/projects", ProjectsResponse),
  createProject: (name: string) => request("POST", "/api/projects", ProjectResponse, { name }),
  openProject: (id: string) => request("POST", `/api/projects/${id}/open`, ProjectResponse, {}),
  trashProject: (id: string) => request("POST", `/api/projects/${id}/trash`, TrashProjectResponse, {}),
  restoreProject: (id: string) => request("POST", `/api/projects/${id}/restore`, ProjectResponse, {}),
  listFeedback: () => request("GET", "/api/feedback", FeedbackListResponse),
  createFeedback: (fields: FeedbackCreateFields, images: Array<{ file: File; thumb: Blob | null }>) => {
    const form = new FormData();
    form.set("text", fields.text);
    form.set("view", fields.view);
    if (fields.nodeId) form.set("nodeId", fields.nodeId);
    form.set("tags", JSON.stringify(fields.tags ?? []));
    for (const { file, thumb } of images) {
      form.append("image", file, file.name || "screenshot");
      // An empty entry keeps thumbnails paired with their image by position.
      form.append("thumb", thumb ?? new Blob([]), "thumb.webp");
    }
    return request("POST", "/api/feedback", FeedbackItemResponse, form);
  },
  moveFeedback: (id: string, aboveId: string | null, belowId: string | null) =>
    request("PUT", `/api/feedback/${id}/position`, FeedbackItemResponse, { aboveId, belowId }),
  resolveFeedback: (id: string) => request("POST", `/api/feedback/${id}/resolve`, FeedbackItemResponse, {}),
  reopenFeedback: (id: string) => request("POST", `/api/feedback/${id}/reopen`, FeedbackItemResponse, {}),
  getSettings: () => request("GET", "/api/settings", SettingsResponse),
  saveSettings: (patch: SaveSettingsBody) => request("PUT", "/api/settings", SettingsResponse, patch),
  getSuggestions: (nodeId: string) =>
    request("POST", `/api/nodes/${nodeId}/suggestions`, SuggestionsResponse, {}),
  refreshSummary: (nodeId: string) =>
    request("POST", `/api/nodes/${nodeId}/summary/refresh`, RefreshResponse, {}),
};
