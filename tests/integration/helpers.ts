/// <reference types="vite/client" />
/* eslint-disable @typescript-eslint/no-explicit-any -- test helper returns loosely typed JSON */
type RouteModule = Record<string, unknown>;

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

// Every route handler under src/app/api, found by path: `[param]` segments become captures. More
// specific routes (fewer params) are tried first, so a fixed segment wins over a `[param]` one.
const modules = import.meta.glob<RouteModule>("/src/app/api/**/route.ts");
const routes = Object.entries(modules)
  .map(([file, load]) => {
    const segments = file.replace(/^\/src\/app/, "").replace(/\/route\.ts$/, "").split("/").filter(Boolean);
    const keys: string[] = [];
    const pattern = segments
      .map((seg) => {
        const param = /^\[(.+)\]$/.exec(seg);
        if (!param) return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        keys.push(param[1]);
        return "([^/]+)";
      })
      .join("/");
    return { pattern: new RegExp(`^/${pattern}$`), keys, load };
  })
  .sort((a, b) => a.keys.length - b.keys.length);

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

/** Starts a tree in a project and waits until its first reply has ended. */
export async function startTree(projectId: string, content: string) {
  const res = await call("POST", "/api/trees?wait=1", { projectId, content });
  if (res.status !== 201) throw new Error(`startTree failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { tree: any; edge: any; answer: any };
}

/** Asks from an element and waits until the reply has ended (Feature 2 made sending asynchronous). */
export function askAndWait(elementId: string, content: string) {
  return call("POST", `/api/nodes/${elementId}/ask?wait=1`, { content });
}

/** A fresh project to work in. */
export async function newProject(name = "Test project"): Promise<string> {
  const res = await call("POST", "/api/projects", { name });
  return res.body.project.id;
}

/** Reads a Server-Sent Events route to the end and returns its events. */
export async function readStream(answerId: string): Promise<Array<{ event: string; data: any }>> {
  const mod = await import("@/app/api/answers/[answerId]/stream/route");
  const req = new Request(`http://127.0.0.1:3000/api/answers/${answerId}/stream`, {
    headers: { host: "127.0.0.1:3000" },
  });
  const res = await mod.GET(req, { params: Promise.resolve({ answerId }) });
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
  view: "chat" | "map" | "definitions" | "canvas";
  projectId?: string;
  elementId?: string;
  tags?: string[];
  images?: Array<{ bytes: Uint8Array; name?: string; type?: string }>;
  thumbs?: Array<{ bytes: Uint8Array } | null>;
}) {
  const form = new FormData();
  form.set("text", fields.text);
  form.set("view", fields.view);
  if (fields.projectId) form.set("projectId", fields.projectId);
  if (fields.elementId) form.set("elementId", fields.elementId);
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
