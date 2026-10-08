import type { ZodType } from "zod";
import {
  AnswerResponse,
  AskResponse,
  BranchResponse,
  type Camera,
  CameraResponse,
  CanvasResponse,
  CaptureResponse,
  DefinitionDetailResponse,
  DefinitionResponse,
  DefinitionsResponse,
  DrillResponse,
  DrillsResponse,
  DrillStepResponse,
  type DrillVerdict,
  EdgeResponse,
  ElementResponse,
  ErrorBody,
  type FeedbackCreateFields,
  FeedbackItemResponse,
  FeedbackListResponse,
  FireParkedResponse,
  FunctionsResponse,
  KindSettingsResponse,
  OriginResponse,
  OutputResponse,
  PanelResponse,
  ParkedResponse,
  ProjectResponse,
  ProjectsResponse,
  RunFunctionResponse,
  type RungState,
  type SaveSettingsBody,
  SendResponse,
  SettingResponse,
  SettingsResponse,
  type SpanRequest,
  StartTreeResponse,
  TermIndexResponse,
  TrashProjectResponse,
} from "@/shared/schemas";
import { z } from "zod";
import { ResolvedSetting } from "@/shared/schemas";

const EdgeSettingsResponse = z.object({ kind: z.string(), settings: z.array(ResolvedSetting) });

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

const RedraftResponse = z.object({ queued: z.literal(true) });

/** Client methods for every route in contracts/http-api.md (Feature 10) and the carried-over ones. */
export const api = {
  // Canvas
  getCanvas: (projectId: string) => request("GET", `/api/canvas?projectId=${projectId}`, CanvasResponse),
  saveCamera: (projectId: string, camera: Camera) =>
    request("PUT", `/api/projects/${projectId}/camera`, CameraResponse, camera),
  setTreeOrigin: (treeId: string, x: number, y: number, byUser = true) =>
    request("PUT", `/api/trees/${treeId}/origin`, OriginResponse, { x, y, byUser }),
  setPosition: (elementId: string, x: number, y: number) =>
    request("PUT", `/api/nodes/${elementId}/position`, ElementResponse, { x, y }),
  // Asking
  startTree: (projectId: string, content: string) =>
    request("POST", "/api/trees", StartTreeResponse, { projectId, content }),
  ask: (elementId: string, content: string) => request("POST", `/api/nodes/${elementId}/ask`, AskResponse, { content }),
  branch: (elementId: string, span: SpanRequest) =>
    request("POST", `/api/nodes/${elementId}/branches`, BranchResponse, span),
  sendUnsent: (edgeId: string, content: string) =>
    request("POST", `/api/edges/${edgeId}/send`, SendResponse, { content }),
  attempt: (edgeId: string, mode: "retry" | "regenerate") =>
    request("POST", `/api/edges/${edgeId}/attempts`, AnswerResponse, { mode }),
  stop: (answerId: string) => request("POST", `/api/answers/${answerId}/stop`, AnswerResponse, {}),
  // Notes and the side panel
  setNote: (edgeId: string, text: string | null) => request("PUT", `/api/edges/${edgeId}/note`, EdgeResponse, { text }),
  panel: (elementId: string) => request("GET", `/api/nodes/${elementId}/panel`, PanelResponse),
  // Parked tangents
  park: (elementId: string, span: SpanRequest, question: string | null) =>
    request("POST", `/api/nodes/${elementId}/parked`, ParkedResponse, { ...span, question }),
  setParkedQuestion: (id: string, question: string | null) =>
    request("PUT", `/api/parked/${id}/question`, ParkedResponse, { question }),
  discardParked: (id: string) => request("POST", `/api/parked/${id}/discard`, ParkedResponse, {}),
  fireParked: (id: string) => request("POST", `/api/parked/${id}/fire`, FireParkedResponse, {}),
  // Definitions
  captureDefinition: (body: { nodeId: string; start: number; end: number; text: string }) =>
    request("POST", "/api/definitions", CaptureResponse, body),
  listDefinitions: () => request("GET", "/api/definitions", DefinitionsResponse),
  getTermIndex: () => request("GET", "/api/definitions?index=1", TermIndexResponse),
  getDefinition: (id: string) => request("GET", `/api/definitions/${id}`, DefinitionDetailResponse),
  confirmDefinition: (id: string) => request("POST", `/api/definitions/${id}/confirm`, DefinitionResponse, {}),
  editDefinition: (id: string, generalText: string, usageText: string) =>
    request("POST", `/api/definitions/${id}/versions`, DefinitionResponse, { generalText, usageText }),
  redraftDefinition: (id: string) => request("POST", `/api/definitions/${id}/redraft`, RedraftResponse, {}),
  // Projects
  listProjects: () => request("GET", "/api/projects", ProjectsResponse),
  createProject: (name: string) => request("POST", "/api/projects", ProjectResponse, { name }),
  openProject: (id: string) => request("POST", `/api/projects/${id}/open`, ProjectResponse, {}),
  trashProject: (id: string) => request("POST", `/api/projects/${id}/trash`, TrashProjectResponse, {}),
  restoreProject: (id: string) => request("POST", `/api/projects/${id}/restore`, ProjectResponse, {}),
  // Feedback
  listFeedback: () => request("GET", "/api/feedback", FeedbackListResponse),
  createFeedback: (fields: FeedbackCreateFields, images: Array<{ file: File; thumb: Blob | null }>) => {
    const form = new FormData();
    form.set("text", fields.text);
    form.set("view", fields.view);
    if (fields.projectId) form.set("projectId", fields.projectId);
    if (fields.elementId) form.set("elementId", fields.elementId);
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
  // Reply settings (Feature 6)
  getSettings: () => request("GET", "/api/settings", SettingsResponse),
  saveSettings: (patch: SaveSettingsBody) => request("PUT", "/api/settings", SettingsResponse, patch),
  // Functions, reviews and kind settings
  listFunctions: (elementId: string) => request("GET", `/api/nodes/${elementId}/functions`, FunctionsResponse),
  runFunction: (elementId: string, functionId: string) =>
    request("POST", `/api/nodes/${elementId}/functions/${functionId}/run`, RunFunctionResponse, {}),
  rerun: (edgeId: string) => request("POST", `/api/edges/${edgeId}/rerun`, OutputResponse, {}),
  confirmOutput: (outputId: string) => request("POST", `/api/nodes/${outputId}/confirm`, OutputResponse, {}),
  rejectOutput: (outputId: string) => request("POST", `/api/nodes/${outputId}/reject`, OutputResponse, {}),
  getKindSettings: () => request("GET", "/api/kind-settings", KindSettingsResponse),
  saveKindSetting: (kind: string, key: string, value: string | null) =>
    request("PUT", "/api/kind-settings", SettingResponse, { kind, key, value }),
  edgeSettings: (edgeId: string) => request("GET", `/api/edges/${edgeId}/settings`, EdgeSettingsResponse),
  saveEdgeSetting: (edgeId: string, key: string, value: string | null) =>
    request("PUT", `/api/edges/${edgeId}/settings`, SettingResponse, { key, value }),
};

// Feature 12: Drill Kaizen (specs/012-drill-kaizen/contracts/http-api.md). Every action returns the
// drill as it is now.
export const drillApi = {
  list: (projectId: string) => request("GET", `/api/drills?projectId=${projectId}`, DrillsResponse),
  get: (drillId: string) => request("GET", `/api/drills/${drillId}`, DrillResponse),
  create: (body: { projectId: string; domain: string; sourceNodeId?: string; offerId?: string }) =>
    request("POST", "/api/drills", DrillResponse, body),
  saveLadder: (drillId: string, rungs: Array<{ id?: string; name: string; removed?: boolean }>) =>
    request("POST", `/api/drills/${drillId}/ladder`, DrillResponse, { rungs }),
  start: (drillId: string) => request("POST", `/api/drills/${drillId}/start`, DrillStepResponse, {}),
  nextRound: (drillId: string) => request("POST", `/api/drills/${drillId}/rounds`, DrillResponse, {}),
  endRound: (roundId: string, by: "all_answered" | "user") =>
    request("POST", `/api/drill-rounds/${roundId}/end`, DrillStepResponse, { by }),
  attempt: (problemId: string, text: string) =>
    request("POST", `/api/drill-problems/${problemId}/attempts`, DrillStepResponse, { text }),
  judge: (attemptId: string) => request("POST", `/api/drill-attempts/${attemptId}/judge`, DrillStepResponse, {}),
  event: (problemId: string, type: "hint" | "reveal" | "skip" | "flag", reason?: string) =>
    request("POST", `/api/drill-problems/${problemId}/events`, DrillResponse, { type, reason }),
  replace: (problemId: string) => request("POST", `/api/drill-problems/${problemId}/replace`, DrillResponse, {}),
  override: (verdictId: string, verdict: DrillVerdict) =>
    request("POST", `/api/drill-verdicts/${verdictId}/override`, DrillResponse, { verdict }),
  setLevel: (drillId: string, rungId: string, to: { level?: number; state?: RungState }) =>
    request("POST", `/api/drills/${drillId}/rungs/${rungId}/level`, DrillResponse, to),
  attach: (drillId: string, nodeId: string, action: "attach" | "detach") =>
    request("POST", `/api/drills/${drillId}/attachments`, DrillResponse, { nodeId, action }),
  dismissOffer: (offerId: string) => request("POST", `/api/drill-offers/${offerId}/dismiss`, DrillResponse, {}),
  saveSetting: (drillNodeId: string, key: string, value: string | null) =>
    request("PUT", "/api/kind-settings", SettingResponse, { kind: "drill", nodeId: drillNodeId, key, value }),
};
