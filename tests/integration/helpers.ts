/* eslint-disable @typescript-eslint/no-explicit-any -- test helper returns loosely typed JSON */
type RouteModule = Record<string, unknown>;

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const routes: Array<{ pattern: RegExp; keys: string[]; load: () => Promise<RouteModule> }> = [
  { pattern: /^\/api\/forest$/, keys: [], load: () => import("@/app/api/forest/route") },
  { pattern: /^\/api\/trees$/, keys: [], load: () => import("@/app/api/trees/route") },
  { pattern: /^\/api\/settings$/, keys: [], load: () => import("@/app/api/settings/route") },
  { pattern: /^\/api\/kind-settings$/, keys: [], load: () => import("@/app/api/kind-settings/route") },
  {
    pattern: /^\/api\/nodes\/([^/]+)\/settings$/,
    keys: ["nodeId"],
    load: () => import("@/app/api/nodes/[nodeId]/settings/route"),
  },
  {
    pattern: /^\/api\/nodes\/([^/]+)\/output\/confirm$/,
    keys: ["nodeId"],
    load: () => import("@/app/api/nodes/[nodeId]/output/confirm/route"),
  },
  {
    pattern: /^\/api\/nodes\/([^/]+)\/output\/reject$/,
    keys: ["nodeId"],
    load: () => import("@/app/api/nodes/[nodeId]/output/reject/route"),
  },
  {
    pattern: /^\/api\/nodes\/([^/]+)\/output\/regenerate$/,
    keys: ["nodeId"],
    load: () => import("@/app/api/nodes/[nodeId]/output/regenerate/route"),
  },
  {
    pattern: /^\/api\/nodes\/([^/]+)\/output$/,
    keys: ["nodeId"],
    load: () => import("@/app/api/nodes/[nodeId]/output/route"),
  },
  {
    pattern: /^\/api\/nodes\/([^/]+)\/pipe$/,
    keys: ["nodeId"],
    load: () => import("@/app/api/nodes/[nodeId]/pipe/route"),
  },
  {
    pattern: /^\/api\/nodes\/([^/]+)\/functions$/,
    keys: ["nodeId"],
    load: () => import("@/app/api/nodes/[nodeId]/functions/route"),
  },
  {
    pattern: /^\/api\/nodes\/([^/]+)\/functions\/([^/]+)\/run$/,
    keys: ["nodeId", "functionId"],
    load: () => import("@/app/api/nodes/[nodeId]/functions/[functionId]/run/route"),
  },
  {
    pattern: /^\/api\/summaries\/refresh-stale$/,
    keys: [],
    load: () => import("@/app/api/summaries/refresh-stale/route"),
  },
  {
    pattern: /^\/api\/trees\/([^/]+)\/origin$/,
    keys: ["treeId"],
    load: () => import("@/app/api/trees/[treeId]/origin/route"),
  },
  {
    pattern: /^\/api\/nodes\/([^/]+)$/,
    keys: ["nodeId"],
    load: () => import("@/app/api/nodes/[nodeId]/route"),
  },
  {
    pattern: /^\/api\/nodes\/([^/]+)\/messages$/,
    keys: ["nodeId"],
    load: () => import("@/app/api/nodes/[nodeId]/messages/route"),
  },
  {
    pattern: /^\/api\/nodes\/([^/]+)\/branches$/,
    keys: ["nodeId"],
    load: () => import("@/app/api/nodes/[nodeId]/branches/route"),
  },
  {
    pattern: /^\/api\/nodes\/([^/]+)\/summary\/refresh$/,
    keys: ["nodeId"],
    load: () => import("@/app/api/nodes/[nodeId]/summary/refresh/route"),
  },
  {
    pattern: /^\/api\/messages\/([^/]+)\/stream$/,
    keys: ["messageId"],
    load: () => import("@/app/api/messages/[messageId]/stream/route"),
  },
  {
    pattern: /^\/api\/messages\/([^/]+)\/stop$/,
    keys: ["messageId"],
    load: () => import("@/app/api/messages/[messageId]/stop/route"),
  },
  {
    pattern: /^\/api\/nodes\/([^/]+)\/position$/,
    keys: ["nodeId"],
    load: () => import("@/app/api/nodes/[nodeId]/position/route"),
  },
  { pattern: /^\/api\/definitions$/, keys: [], load: () => import("@/app/api/definitions/route") },
  {
    pattern: /^\/api\/definitions\/([^/]+)$/,
    keys: ["id"],
    load: () => import("@/app/api/definitions/[id]/route"),
  },
  {
    pattern: /^\/api\/definitions\/([^/]+)\/confirm$/,
    keys: ["id"],
    load: () => import("@/app/api/definitions/[id]/confirm/route"),
  },
  {
    pattern: /^\/api\/definitions\/([^/]+)\/versions$/,
    keys: ["id"],
    load: () => import("@/app/api/definitions/[id]/versions/route"),
  },
  {
    pattern: /^\/api\/definitions\/([^/]+)\/redraft$/,
    keys: ["id"],
    load: () => import("@/app/api/definitions/[id]/redraft/route"),
  },
  {
    pattern: /^\/api\/nodes\/([^/]+)\/edge-label$/,
    keys: ["nodeId"],
    load: () => import("@/app/api/nodes/[nodeId]/edge-label/route"),
  },
  {
    pattern: /^\/api\/messages\/([^/]+)\/retry$/,
    keys: ["messageId"],
    load: () => import("@/app/api/messages/[messageId]/retry/route"),
  },
  {
    pattern: /^\/api\/messages\/([^/]+)\/regenerate$/,
    keys: ["messageId"],
    load: () => import("@/app/api/messages/[messageId]/regenerate/route"),
  },
  { pattern: /^\/api\/feedback$/, keys: [], load: () => import("@/app/api/feedback/route") },
  { pattern: /^\/api\/projects$/, keys: [], load: () => import("@/app/api/projects/route") },
  {
    pattern: /^\/api\/projects\/([^/]+)\/(open|trash|restore)$/,
    keys: ["id", "action"],
    load: async () => {
      // One pattern for the three project actions; pick the module by the last path segment.
      const mods = {
        open: await import("@/app/api/projects/[id]/open/route"),
        trash: await import("@/app/api/projects/[id]/trash/route"),
        restore: await import("@/app/api/projects/[id]/restore/route"),
      };
      return { POST: (req: Request, ctx: { params: Promise<Record<string, string>> }) =>
        ctx.params.then((p) => (mods as any)[p.action].POST(req, ctx)) };
    },
  },
  {
    pattern: /^\/api\/feedback\/attachments\/([^/]+)$/,
    keys: ["id"],
    load: () => import("@/app/api/feedback/attachments/[id]/route"),
  },
  {
    pattern: /^\/api\/feedback\/([^/]+)\/position$/,
    keys: ["id"],
    load: () => import("@/app/api/feedback/[id]/position/route"),
  },
  {
    pattern: /^\/api\/feedback\/([^/]+)\/resolve$/,
    keys: ["id"],
    load: () => import("@/app/api/feedback/[id]/resolve/route"),
  },
  {
    pattern: /^\/api\/feedback\/([^/]+)\/reopen$/,
    keys: ["id"],
    load: () => import("@/app/api/feedback/[id]/reopen/route"),
  },
  {
    pattern: /^\/api\/nodes\/([^/]+)\/parked$/,
    keys: ["nodeId"],
    load: () => import("@/app/api/nodes/[nodeId]/parked/route"),
  },
  {
    pattern: /^\/api\/parked\/([^/]+)\/question$/,
    keys: ["id"],
    load: () => import("@/app/api/parked/[id]/question/route"),
  },
  {
    pattern: /^\/api\/parked\/([^/]+)\/discard$/,
    keys: ["id"],
    load: () => import("@/app/api/parked/[id]/discard/route"),
  },
  {
    pattern: /^\/api\/parked\/([^/]+)\/fire$/,
    keys: ["id"],
    load: () => import("@/app/api/parked/[id]/fire/route"),
  },
];

export type CallResult<T = any> = { status: number; body: T };

/** Invokes a route handler directly, as a request from the app itself. */
export async function call<T = any>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<CallResult<T>> {
  const res = await callRaw(method, path, body, headers);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}

/** Like `call`, but returns the raw Response (binary bodies). A FormData body is sent as multipart. */
export async function callRaw(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  const isForm = body instanceof FormData;
  for (const route of routes) {
    const pathOnly = path.split("?")[0];
    const match = route.pattern.exec(pathOnly);
    if (!match) continue;
    const mod = await route.load();
    const handler = mod[method] as Handler | undefined;
    if (!handler) return new Response(null, { status: 405 });
    const params = Object.fromEntries(route.keys.map((k, i) => [k, match[i + 1]]));
    const req = new Request(`http://127.0.0.1:3000${path}`, {
      method,
      headers: {
        host: "127.0.0.1:3000",
        ...(isForm ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    return handler(req, { params: Promise.resolve(params) });
  }
  throw new Error(`No route for ${method} ${path}`);
}

/** Sends a message and waits until its reply has ended (Feature 2 made sending asynchronous). */
export function sendAndWait(nodeId: string, content: string) {
  return call("POST", `/api/nodes/${nodeId}/messages?wait=1`, { content });
}

/** Reads a Server-Sent Events route to the end and returns its events. */
export async function readStream(messageId: string): Promise<Array<{ event: string; data: any }>> {
  const mod = await import("@/app/api/messages/[messageId]/stream/route");
  const req = new Request(`http://127.0.0.1:3000/api/messages/${messageId}/stream`, {
    headers: { host: "127.0.0.1:3000" },
  });
  const res = await mod.GET(req, { params: Promise.resolve({ messageId }) });
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const event = /^event: (.*)$/m.exec(chunk)?.[1] ?? "message";
      const data = JSON.parse(/^data: (.*)$/m.exec(chunk)?.[1] ?? "null");
      return { event, data };
    });
}

/** Posts a feedback item as the drawer does (multipart). */
export function createFeedback(fields: {
  text: string;
  view: "chat" | "map" | "definitions";
  nodeId?: string;
  tags?: string[];
  images?: Array<{ bytes: Uint8Array; name?: string; type?: string }>;
  thumbs?: Array<{ bytes: Uint8Array } | null>;
}) {
  const form = new FormData();
  form.set("text", fields.text);
  form.set("view", fields.view);
  if (fields.nodeId) form.set("nodeId", fields.nodeId);
  if (fields.tags) form.set("tags", JSON.stringify(fields.tags));
  (fields.images ?? []).forEach((img, i) => {
    form.append("image", new File([new Uint8Array(img.bytes)], img.name ?? `shot-${i}.png`, { type: img.type ?? "image/png" }));
    const thumb = fields.thumbs?.[i];
    form.append("thumb", thumb ? new File([new Uint8Array(thumb.bytes)], "thumb.webp", { type: "image/webp" }) : new File([], ""));
  });
  return call("POST", "/api/feedback", form);
}

export async function readFeedbackFile(): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const { feedbackFilePath } = await import("@/server/feedback/paths");
  return readFile(feedbackFilePath(), "utf8");
}
