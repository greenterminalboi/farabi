import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";
import { setSession } from "@/server/host/session";

const PORT = 51873;
const SECRET = "A".repeat(43);
const ORIGIN = `http://127.0.0.1:${PORT}`;

function req(path: string, init: { method?: string; host?: string; cookie?: string; bearer?: string; origin?: string } = {}) {
  const headers = new Headers({ host: init.host ?? `127.0.0.1:${PORT}` });
  if (init.cookie) headers.set("cookie", `farabi_session=${init.cookie}`);
  if (init.bearer) headers.set("authorization", `Bearer ${init.bearer}`);
  if (init.origin) headers.set("origin", init.origin);
  return new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? "GET", headers });
}

/** NextResponse.next() carries this header; a short-circuit response doesn't. */
const passed = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("proxy request rules (contracts/launch-session.md)", () => {
  beforeEach(() => {
    vi.stubEnv("FARABI_HOST", "tauri");
    setSession({ secret: SECRET, port: PORT });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("421 for a Host other than 127.0.0.1:<port> (DNS rebinding)", () => {
    expect(proxy(req("/", { host: `localhost:${PORT}`, cookie: SECRET })).status).toBe(421);
    expect(proxy(req("/", { host: "evil.example", cookie: SECRET })).status).toBe(421);
  });

  it("401 without the cookie or bearer, with an empty body", async () => {
    const res = proxy(req("/api/settings"));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
    expect(proxy(req("/api/settings", { cookie: "B".repeat(43) })).status).toBe(401);
  });

  it("lets the session route through without credentials", () => {
    expect(passed(proxy(req("/__farabi/session?t=x")))).toBe(true);
    expect(passed(proxy(req("/%5F%5Ffarabi/session?t=x")))).toBe(true);
    expect(proxy(req("/%5F%5Ffarabi/other")).status).toBe(401);
  });

  it("passes with the session cookie or a bearer", () => {
    expect(passed(proxy(req("/api/settings", { cookie: SECRET })))).toBe(true);
    expect(passed(proxy(req("/api/settings", { bearer: SECRET })))).toBe(true);
  });

  it("403 for a state-changing request from a foreign Origin", () => {
    expect(proxy(req("/api/settings", { method: "PUT", cookie: SECRET, origin: "http://evil.example" })).status).toBe(403);
    // No Origin is only acceptable together with a valid bearer (the CLI).
    expect(proxy(req("/api/settings", { method: "PUT", cookie: SECRET })).status).toBe(403);
    expect(passed(proxy(req("/api/settings", { method: "PUT", bearer: SECRET })))).toBe(true);
    expect(passed(proxy(req("/api/settings", { method: "PUT", cookie: SECRET, origin: ORIGIN })))).toBe(true);
  });

  it("lets only the CLI's bearer mark feedback addressed", () => {
    const path = "/api/feedback/0b6f1c1e-0000-4000-8000-000000000000/addressed";
    expect(proxy(req(path, { method: "POST", cookie: SECRET, origin: ORIGIN })).status).toBe(403);
    expect(passed(proxy(req(path, { method: "POST", bearer: SECRET })))).toBe(true);
  });

  it("sets the security headers on passed requests", () => {
    const res = proxy(req("/", { cookie: SECRET }));
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});

describe("proxy in the web app", () => {
  it("passes everything through when FARABI_HOST is unset", () => {
    vi.stubEnv("FARABI_HOST", "");
    expect(passed(proxy(req("/api/settings", { host: "localhost:3000" })))).toBe(true);
    vi.unstubAllEnvs();
  });
});
