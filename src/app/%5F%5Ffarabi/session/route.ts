// Exchanges the per-launch secret in the window's first URL for a session cookie, then sends the
// window to the app (feature 11, contracts/launch-session.md step 7).
import { NextResponse, type NextRequest } from "next/server";
import { getSession, matchesSecret, SESSION_COOKIE } from "@/server/host/session";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const session = getSession();
  if (!session || !matchesSecret(request.nextUrl.searchParams.get("t"))) return new NextResponse(null, { status: 401 });
  const res = new NextResponse(null, {
    status: 303,
    headers: { Location: "/", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
  res.cookies.set(SESSION_COOKIE, session.secret, { httpOnly: true, sameSite: "strict", path: "/" });
  return res;
}
