/* eslint-disable @typescript-eslint/no-explicit-any -- test helper returns loosely typed JSON */
type RouteModule = Record<string, unknown>;

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const routes: Array<{ pattern: RegExp; keys: string[]; load: () => Promise<RouteModule> }> = [
  { pattern: /^\/api\/forest$/, keys: [], load: () => import("@/app/api/forest/route") },
  { pattern: /^\/api\/trees$/, keys: [], load: () => import("@/app/api/trees/route") },
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
    pattern: /^\/api\/messages\/([^/]+)\/retry$/,
    keys: ["messageId"],
    load: () => import("@/app/api/messages/[messageId]/retry/route"),
  },
  {
    pattern: /^\/api\/messages\/([^/]+)\/regenerate$/,
    keys: ["messageId"],
    load: () => import("@/app/api/messages/[messageId]/regenerate/route"),
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
  for (const route of routes) {
    const match = route.pattern.exec(path);
    if (!match) continue;
    const mod = await route.load();
    const handler = mod[method] as Handler | undefined;
    if (!handler) return { status: 405, body: undefined as T };
    const params = Object.fromEntries(route.keys.map((k, i) => [k, match[i + 1]]));
    const req = new Request(`http://127.0.0.1:3000${path}`, {
      method,
      headers: { host: "127.0.0.1:3000", "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res = await handler(req, { params: Promise.resolve(params) });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
  }
  throw new Error(`No route for ${method} ${path}`);
}
