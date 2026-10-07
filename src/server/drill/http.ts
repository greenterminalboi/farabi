// Route helpers for the drill API (contracts/http-api.md): v0.2's withApi, plus the drill's one
// error that carries data, a verdict that failed after its attempt was stored.
import { withApi } from "../http/withApi";
import { VerdictUnavailableError } from "./attempts";
import { loadDrill } from "./load";

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

export function withDrillApi<C>(handler: Handler<C>): Handler<C> {
  return withApi(async (req: Request, ctx: C) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof VerdictUnavailableError) {
        return Response.json({ error: { code: err.code, message: err.message }, attemptId: err.attemptId }, { status: 503 });
      }
      throw err;
    }
  });
}

/** The drill as it is now, with any extras an action returns. */
export async function drillResponse(drillId: string, extra: object = {}, status = 200): Promise<Response> {
  return Response.json({ drill: await loadDrill(drillId), ...extra }, { status });
}
