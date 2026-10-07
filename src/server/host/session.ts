// The per-launch session the window and the CLI must present (feature 11,
// contracts/launch-session.md). Set from the shell's `hello`; held on globalThis because the proxy
// and the route handlers are bundled separately but run in the same process.
import { timingSafeEqual } from "node:crypto";

export type Session = { secret: string; port: number };
export const SESSION_COOKIE = "farabi_session";
export const SESSION_PATH = "/__farabi/session";

const g = globalThis as unknown as { __farabiSession?: Session };

export function setSession(session: Session): void {
  g.__farabiSession = session;
}

export function getSession(): Session | undefined {
  return g.__farabiSession;
}

/** Constant-time comparison of a presented value with the secret. */
export function matchesSecret(presented: string | null | undefined): boolean {
  const s = g.__farabiSession?.secret;
  if (!s || !presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(s);
  return a.length === b.length && timingSafeEqual(a, b);
}
