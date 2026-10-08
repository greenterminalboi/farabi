// The e2e run's stand-in for the Tauri shell (feature 11 cut-over): starts the packaged server in
// real desktop mode (session rules, CSP, runtime.json, the bridge) on a fresh data folder, and
// answers the bridge the way the shell would, minus the OS dialogs and keychain.
//
//   tsx scripts/desktop/e2e-server.ts <server dir> <data dir> <port> <secret>
//
// Playwright sends the secret as a bearer token on every request (playwright.config.ts).
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

const [serverDir, dataDirArg, port, secret] = process.argv.slice(2);
if (!serverDir || !dataDirArg || !port || !secret) {
  console.error("usage: e2e-server.ts <server dir> <data dir> <port> <secret>");
  process.exit(1);
}
const dataDir = path.resolve(dataDirArg);
const PREFIX = "\u001eFARABI1 ";

rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });

const child = spawn(process.execPath, [path.join(path.resolve(serverDir), "server.js")], {
  cwd: path.resolve(serverDir),
  env: { ...process.env, FARABI_HOST: "tauri", FARABI_DATA_DIR: dataDir, HOSTNAME: "127.0.0.1", PORT: port, NODE_ENV: "production" },
  stdio: ["pipe", "pipe", "inherit"],
});

const send = (msg: unknown) => child.stdin.write(`${JSON.stringify(msg)}\n`);
// An in-memory "keychain", so the API key settings work in tests without touching the real one.
const credentials = new Map<string, string>();

function answer(type: string, params: Record<string, unknown> | undefined): unknown {
  const name = String(params?.name ?? "");
  switch (type) {
    case "credentials.get": {
      const value = credentials.get(name);
      return params?.reveal && value ? { present: true, value } : { present: Boolean(value) };
    }
    case "credentials.set":
      credentials.set(name, String(params?.value ?? ""));
      send({ v: 1, event: "credentials.changed", data: { name } });
      return { ok: true };
    case "credentials.delete":
      credentials.delete(name);
      send({ v: 1, event: "credentials.changed", data: { name } });
      return { ok: true };
    case "dialog.pickFolder":
    case "dialog.pickFile":
      return { path: null };
    case "shell.reveal":
    case "window.focus":
      return { ok: true };
    default:
      throw new Error(`unsupported in e2e: ${type}`);
  }
}

createInterface({ input: child.stdout }).on("line", (line) => {
  if (!line.startsWith(PREFIX)) return void console.log(line);
  const msg = JSON.parse(line.slice(PREFIX.length)) as { id?: string; type?: string; params?: Record<string, unknown>; event?: string; data?: unknown; re?: string };
  if (msg.event) {
    console.log(`[e2e-shell] ${msg.event} ${JSON.stringify(msg.data)}`);
    if (msg.event === "blocked" || msg.event === "fatal") process.exit(1);
    return;
  }
  if (msg.id && msg.type) {
    try {
      send({ v: 1, re: msg.id, ok: true, result: answer(msg.type, msg.params) });
    } catch (err) {
      send({ v: 1, re: msg.id, ok: false, error: { code: "unsupported", message: (err as Error).message } });
    }
  }
});

send({
  v: 1,
  id: "h1",
  type: "hello",
  params: { secret, port: Number(port), dataDir, logDir: path.join(dataDir, "logs"), appVersion: "e2e", platform: "macos", arch: process.arch },
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  send({ v: 1, id: "s1", type: "shutdown", params: { reason: "quit" } });
  setTimeout(() => child.kill("SIGKILL"), 5000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("exit", (code) => process.exit(stopping ? 0 : (code ?? 1)));
