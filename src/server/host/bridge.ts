// The private channel between the Tauri shell and this server: line-delimited JSON over the
// server's stdin/stdout (feature 11, contracts/host-bridge.md, research R5). In the web app
// (FARABI_HOST unset) there is no shell, and the helpers at the bottom fall back to env and no-ops.
import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";

export const MAX_LINE_BYTES = 1024 * 1024;
/**
 * Marks the server's protocol lines on stdout. Next.js itself prints to stdout too (its banner,
 * "Ready in…"), so the shell reads only lines that start with this and logs the rest.
 */
export const LINE_PREFIX = "\u001eFARABI1 ";

export type Hello = {
  secret: string;
  port: number;
  dataDir: string;
  logDir: string;
  appVersion: string;
  platform: "macos" | "windows";
  arch: string;
};

type Request = { v: 1; id: string; type: string; params?: unknown };
type Response = { v: 1; re: string; ok: true; result?: unknown } | { v: 1; re: string; ok: false; error: { code: string; message: string } };
type Handler = (params: unknown) => Promise<unknown> | unknown;

export class BridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

export function isDesktop(): boolean {
  return process.env.FARABI_HOST === "tauri";
}

export class Bridge {
  /** Resolves with the shell's `hello`; nothing else is handled before it arrives. */
  readonly hello: Promise<Hello>;
  private resolveHello!: (h: Hello) => void;
  private gotHello = false;
  private nextId = 1;
  private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer?: NodeJS.Timeout }>();
  private readonly handlers = new Map<string, Handler>();
  private buffer = "";
  /** Local listeners: "protocol-error", "closed" and "event:<name>" for shell events. */
  private readonly local = new EventEmitter();

  constructor(
    input: Readable,
    private readonly output: Writable,
  ) {
    this.hello = new Promise((resolve) => (this.resolveHello = resolve));
    input.setEncoding("utf8");
    input.on("data", (chunk: string) => this.onData(chunk));
    input.on("end", () => this.local.emit("closed"));
  }

  /** Sends a request to the shell; rejects with BridgeError("timeout") if no answer comes. */
  request<T = unknown>(type: string, params?: unknown, timeoutMs?: number): Promise<T> {
    const id = `s${this.nextId++}`;
    return new Promise<T>((resolve, reject) => {
      const entry: { resolve: (v: unknown) => void; reject: (e: Error) => void; timer?: NodeJS.Timeout } = {
        resolve: resolve as (v: unknown) => void,
        reject,
      };
      if (timeoutMs !== undefined) {
        entry.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new BridgeError("timeout", `${type} got no answer within ${timeoutMs} ms`));
        }, timeoutMs);
      }
      this.pending.set(id, entry);
      this.write({ v: 1, id, type, ...(params === undefined ? {} : { params }) });
    });
  }

  /** Sends an event to the shell (no answer expected). */
  emit(event: string, data?: unknown): void {
    this.write({ v: 1, event, ...(data === undefined ? {} : { data }) });
  }

  /** Listens locally: "protocol-error", "closed", or "event:<name>" for events from the shell. */
  on(event: string, listener: (...args: unknown[]) => void): void {
    this.local.on(event, listener);
  }

  onRequest(type: string, handler: Handler): void {
    this.handlers.set(type, handler);
  }

  private write(msg: object): void {
    this.output.write(`${LINE_PREFIX}${JSON.stringify(msg)}\n`);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      this.onLine(line);
    }
    if (Buffer.byteLength(this.buffer) > MAX_LINE_BYTES) {
      this.buffer = "";
      this.local.emit("protocol-error", new BridgeError("too_large", "Unterminated line over the size limit"));
    }
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
      this.local.emit("protocol-error", new BridgeError("too_large", "Line over the size limit"));
      return;
    }
    let msg: Partial<Request & Response & { event: string }>;
    try {
      msg = JSON.parse(line);
    } catch {
      this.local.emit("protocol-error", new BridgeError("bad_json", "Line is not JSON"));
      return;
    }
    if (!msg || typeof msg !== "object" || msg.v !== 1) {
      this.local.emit("protocol-error", new BridgeError("bad_version", "Message is not protocol v1"));
      return;
    }
    if (typeof msg.re === "string") return this.onResponse(msg as Response);
    if (typeof msg.event === "string") {
      if (this.gotHello) this.local.emit(`event:${msg.event}`, (msg as { data?: unknown }).data);
      return;
    }
    if (typeof msg.id === "string" && typeof msg.type === "string") void this.onRequestMsg(msg as Request);
  }

  private onResponse(msg: Response): void {
    const entry = this.pending.get(msg.re);
    if (!entry) return;
    this.pending.delete(msg.re);
    if (entry.timer) clearTimeout(entry.timer);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new BridgeError(msg.error?.code ?? "error", msg.error?.message ?? "Shell request failed"));
  }

  private async onRequestMsg(msg: Request): Promise<void> {
    if (msg.type === "hello") {
      if (!this.gotHello) {
        this.gotHello = true;
        this.resolveHello(msg.params as Hello);
      }
      this.write({ v: 1, re: msg.id, ok: true, result: { ok: true } });
      return;
    }
    if (!this.gotHello) return;
    const handler = this.handlers.get(msg.type);
    if (!handler) {
      this.write({ v: 1, re: msg.id, ok: false, error: { code: "unsupported", message: `Unknown request ${msg.type}` } });
      return;
    }
    try {
      const result = await handler(msg.params);
      this.write({ v: 1, re: msg.id, ok: true, ...(result === undefined ? {} : { result }) });
    } catch (err) {
      const code = err instanceof BridgeError ? err.code : "error";
      this.write({ v: 1, re: msg.id, ok: false, error: { code, message: err instanceof Error ? err.message : String(err) } });
    }
  }
}

// One bridge per process, kept on globalThis so dev hot reload never attaches a second reader.
const g = globalThis as unknown as { __farabiBridge?: Bridge };

/** Starts the bridge on the given streams (desktop mode only). Idempotent. */
export function startBridge(input: Readable, output: Writable): Bridge {
  g.__farabiBridge ??= new Bridge(input, output);
  return g.__farabiBridge;
}

export function getBridge(): Bridge | undefined {
  return g.__farabiBridge;
}

function requireBridge(): Bridge {
  const b = getBridge();
  if (!isDesktop() || !b) throw new BridgeError("unsupported", "Only available in the desktop app");
  return b;
}

// ---- Typed helpers (with web-mode fallbacks, contracts/host-bridge.md "Rules") ----

const KEY_NAME = "anthropic-api-key";

export async function getCredential(opts: { reveal: boolean }): Promise<{ present: boolean; value?: string }> {
  if (!isDesktop()) {
    const value = process.env.ANTHROPIC_API_KEY || undefined;
    return opts.reveal && value ? { present: true, value } : { present: Boolean(value) };
  }
  return requireBridge().request("credentials.get", { name: KEY_NAME, reveal: opts.reveal }, 3000);
}

export async function setCredential(value: string): Promise<void> {
  await requireBridge().request("credentials.set", { name: KEY_NAME, value }, 10_000);
}

export async function deleteCredential(): Promise<void> {
  await requireBridge().request("credentials.delete", { name: KEY_NAME }, 3000);
}

export async function pickFolder(params: { title: string; defaultPath?: string }): Promise<string | null> {
  const res = await requireBridge().request<{ path: string | null }>("dialog.pickFolder", params);
  return res.path;
}

export async function reveal(path: string): Promise<void> {
  if (!isDesktop()) return;
  await requireBridge().request("shell.reveal", { path }, 3000);
}

export async function focusWindow(): Promise<void> {
  if (!isDesktop()) return;
  await requireBridge().request("window.focus", undefined, 1000);
}
