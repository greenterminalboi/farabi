// Desktop mode only: every request must come from the app's own window (session cookie) or the
// CLI (bearer), on the exact loopback host, and state changes must come from our own origin
// (feature 11, contracts/launch-session.md, FR-003). In the web app this passes everything.
import { type NextRequest, NextResponse } from "next/server";
import { getSession, matchesSecret, SESSION_COOKIE, SESSION_PATH } from "@/server/host/session";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Routes for the CLI only (research R9): the window's cookie isn't enough. */
const BEARER_ONLY = /^\/api\/feedback\/[^/]+\/addressed$/;

// T023: 'unsafe-inline' scripts are Next's inline bootstrap; ws: only for the dev server (HMR).
// 'unsafe-eval' stays for now: PixiJS 8 compiles its shader and uniform code with `new Function`
// unless the canvas imports `pixi.js/unsafe-eval` (src/canvas, v0.2-owned; handed off in STATUS.md).
// Checked on WebKit with the production build (`webkit-desktop` e2e, FARABI_CSP=1,
// tests/e2e/f11-csp.spec.ts).
function csp(): string {
  const dev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "worker-src 'self' blob:",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
}

const deny = (status: number) => new NextResponse(null, { status });

function withSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set("Content-Security-Policy", csp());
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}

export function proxy(request: NextRequest): NextResponse {
  if (process.env.FARABI_HOST !== "tauri") {
    // FARABI_CSP=1 applies the desktop policy in the web build, so e2e can check it (T023).
    return process.env.FARABI_CSP === "1" ? withSecurityHeaders(NextResponse.next()) : NextResponse.next();
  }

  const session = getSession();
  if (!session) return deny(503);
  const origin = `http://127.0.0.1:${session.port}`;
  if (request.headers.get("host") !== `127.0.0.1:${session.port}`) return deny(421);

  // The route's folder is `%5F%5Ffarabi` (a leading `_` makes App Router folders private), so the
  // window's URL arrives percent-encoded.
  let pathname = request.nextUrl.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // Malformed escapes: keep the raw path, which can't match the session route.
  }
  if (pathname !== SESSION_PATH) {
    const auth = request.headers.get("authorization");
    const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    const viaBearer = matchesSecret(bearer);
    if (!viaBearer && !matchesSecret(request.cookies.get(SESSION_COOKIE)?.value)) return deny(401);
    if (!viaBearer && BEARER_ONLY.test(pathname)) return deny(403);

    if (UNSAFE_METHODS.has(request.method)) {
      const reqOrigin = request.headers.get("origin");
      const ok = reqOrigin ? reqOrigin === origin : viaBearer;
      if (!ok) return deny(403);
    }
  }

  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  // Every path, including static assets: nothing is served without the session.
  matcher: "/:path*",
};
