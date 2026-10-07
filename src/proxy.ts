// Desktop mode only: every request must come from the app's own window (session cookie) or the
// CLI (bearer), on the exact loopback host, and state changes must come from our own origin
// (feature 11, contracts/launch-session.md, FR-003). In the web app this passes everything.
import { type NextRequest, NextResponse } from "next/server";
import { getSession, matchesSecret, SESSION_COOKIE, SESSION_PATH } from "@/server/host/session";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Draft policy; T023 narrows it once the production build is checked on both engines.
function csp(): string {
  const dev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'`,
    "worker-src 'self' blob:",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
}

const deny = (status: number) => new NextResponse(null, { status });

export function proxy(request: NextRequest): NextResponse {
  if (process.env.FARABI_HOST !== "tauri") return NextResponse.next();

  const session = getSession();
  if (!session) return deny(503);
  const origin = `http://127.0.0.1:${session.port}`;
  if (request.headers.get("host") !== `127.0.0.1:${session.port}`) return deny(421);

  if (request.nextUrl.pathname !== SESSION_PATH) {
    const auth = request.headers.get("authorization");
    const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    const viaBearer = matchesSecret(bearer);
    if (!viaBearer && !matchesSecret(request.cookies.get(SESSION_COOKIE)?.value)) return deny(401);

    if (UNSAFE_METHODS.has(request.method)) {
      const reqOrigin = request.headers.get("origin");
      const ok = reqOrigin ? reqOrigin === origin : viaBearer;
      if (!ok) return deny(403);
    }
  }

  const res = NextResponse.next();
  res.headers.set("Content-Security-Policy", csp());
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}

export const config = {
  // Every path, including static assets: nothing is served without the session.
  matcher: "/:path*",
};
