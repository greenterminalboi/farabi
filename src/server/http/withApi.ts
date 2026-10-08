import { ZodError, type ZodType } from "zod";
import { ProviderNotReadyError } from "../ai";
import { BridgeError } from "../host/bridge";
import { FolderNotWritableError } from "../settings/appSettings";
import {
  AIServiceUnavailable,
  ConflictError,
  FunctionUnavailableError,
  InvalidRequestError,
  InvalidSelectionError,
  NotFoundError,
} from "../errors";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function errorResponse(status: number, code: string, message: string, extra?: object): Response {
  return Response.json({ error: { code, message }, ...extra }, { status });
}

/** Rejects requests that did not come from this app on this machine (research R1). */
function isLocalRequest(req: Request): boolean {
  const host = req.headers.get("host");
  if (!host) return false;
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  if (!LOCAL_HOSTS.has(hostname)) return false;
  const origin = req.headers.get("origin");
  if (origin && origin !== "null") {
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export async function readJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new InvalidRequestError("Body must be JSON");
  }
  return schema.parse(body);
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

export function withApi<C>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    if (!isLocalRequest(req)) return errorResponse(403, "forbidden", "Local requests only");
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ProviderNotReadyError) {
        return errorResponse(422, err.code, err.message, { provider: err.provider, reason: err.reason, settingsPath: err.settingsPath });
      }
      if (err instanceof FolderNotWritableError) return errorResponse(422, err.reason, err.message);
      // The desktop shell's answers (feature 11): web mode has no shell, so those routes are 501.
      if (err instanceof BridgeError) {
        const status = err.code === "unsupported" ? 501 : err.code === "forbidden" ? 403 : 502;
        return errorResponse(status, err.code, err.message);
      }
      if (err instanceof ZodError) return errorResponse(422, "invalid_request", err.message);
      if (err instanceof InvalidRequestError) return errorResponse(422, err.code, err.message);
      if (err instanceof InvalidSelectionError) return errorResponse(422, err.code, err.message);
      if (err instanceof NotFoundError) return errorResponse(404, err.code, err.message);
      if (err instanceof ConflictError) return errorResponse(409, err.code, err.message, err.extra);
      if (err instanceof FunctionUnavailableError) return errorResponse(503, err.code, err.message);
      if (err instanceof AIServiceUnavailable)
        return errorResponse(503, err.code, err.message, err.stored);
      console.error(err);
      return errorResponse(500, "internal", "Unexpected server error");
    }
  };
}
