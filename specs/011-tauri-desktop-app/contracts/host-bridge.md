# Contract: Host Bridge (Tauri shell ↔ server, over stdio)

This contract covers the private channel between the Rust shell (`src-tauri/src/bridge.rs`) and
the bundled Next.js server (`src/server/host/bridge.ts`). The shell spawns the server, writes to
its **stdin**, and reads its **stdout**. **stderr** carries log lines only. Research R5.

## Framing

- One JSON object per line, UTF-8, `\n`-terminated. A line is at most 1 MiB, and longer lines are
  a protocol error.
- Stdout is reserved for the bridge. `console.log` is redirected to stderr in desktop mode, so
  stray output cannot corrupt the channel.
- Every message has `"v": 1`.

```ts
type Request  = { v: 1; id: string; type: string; params?: unknown };   // either side may send
type Response = { v: 1; re: string; ok: true; result?: unknown }
              | { v: 1; re: string; ok: false; error: { code: string; message: string } };
type Event    = { v: 1; event: string; data?: unknown };                 // no response expected
```

Ids are unique per sender. A request with no response within its timeout fails with
`code: "timeout"` on the sender's side.

## Shell → server

| Type | Params | Result | Timeout | Notes |
|------|--------|--------|---------|-------|
| `hello` | `{ secret, port, dataDir, logDir, appVersion, platform: "macos" \| "windows", arch }` | `{ ok: true }` | 5 s | The first message; the server ignores everything before it. `secret` is the per-launch session secret (launch-session.md). |
| `shutdown` | `{ reason: "window-closed" \| "quit" \| "update" }` | `{ ok: true }` once drained | 5 s | The server stops live replies as Stop does, closes the store, removes `runtime.json` and `store.lock`, then exits 0. Past the timeout the shell kills it. |

## Server → shell

| Type | Params | Result | Timeout | Notes |
|------|--------|--------|---------|-------|
| `credentials.get` | `{ name: "anthropic-api-key", reveal: boolean }` | `{ present: boolean, value?: string }` | 3 s | `value` only when `reveal: true`, which only the AI client uses and never a route. |
| `credentials.set` | `{ name, value }` | `{ ok: true }` | 10 s | The OS may show a prompt. |
| `credentials.delete` | `{ name }` | `{ ok: true }` | 3 s | Idempotent. |
| `dialog.pickFolder` | `{ title, defaultPath? }` | `{ path: string \| null }` | none (user-paced) | `null` = cancelled. |
| `shell.reveal` | `{ path }` | `{ ok: true }` | 3 s | Only paths under the data dir, log dir or export dir; anything else gives `forbidden`. |
| `window.focus` | — | `{ ok: true }` | 1 s | — |

`name` is an allow-list with one entry (`anthropic-api-key`). Any other name gives `forbidden`.

## Events

| Direction | Event | Data | Meaning |
|-----------|-------|------|---------|
| server → shell | `ready` | `{ port, schemaLevel }` | Navigate the window to the session URL (launch-session.md). |
| server → shell | `blocked` | `{ screen: "newer-data" \| "store-locked" \| "backup-failed" \| "upgrade-failed", detail }` | The shell shows its built-in screen. The server stays up only to receive `shutdown`. |
| server → shell | `fatal` | `{ message }` | The shell shows the "Farabi stopped" screen with **Restart** and **Open logs**. |
| shell → server | `credentials.changed` | `{ name }` | Drop any cached client built with the old key. |

## Rules

- **The secret and the API key never appear in argv, the environment or log lines.** The stderr
  log writer redacts any 20+ character substring that matches the current key or secret (SC-008).
- **Web mode** (`FARABI_HOST` not `tauri`): `bridge.ts` exports the same functions, with fallbacks:
  - `credentials.get` returns `ANTHROPIC_API_KEY` from the environment;
  - `credentials.set` and `credentials.delete` reject with `unsupported`;
  - `dialog.pickFolder` returns `unsupported`, and the UI shows a text field instead;
  - `shell.reveal` is a no-op.
- **Sidecar crash**: if the server process exits without being asked to (not after `shutdown`),
  the shell shows the `fatal` screen. It restarts automatically at most once per 60 s.
