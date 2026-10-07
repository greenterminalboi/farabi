# Contract: Launch and Session

This contract covers how the window reaches the server, and how everything else is kept out
(FR-003, research R4).

## Launch sequence

1. **Single instance.** `tauri-plugin-single-instance` runs first. A second launch only focuses
   the existing window and exits (FR-005).
2. **Window.** The shell restores the window's state (`tauri-plugin-window-state`, clamped to a
   visible monitor) and shows its built-in **starting** page, a local asset rather than the
   server.
3. **Port.** The shell binds `127.0.0.1:0`, reads the port and releases it.
4. **Server.** The shell spawns `node <resources>/server/server.js` with this environment:
   - `HOSTNAME=127.0.0.1`
   - `PORT=<port>`
   - `NODE_ENV=production`
   - `FARABI_HOST=tauri`
   - `FARABI_DATA_DIR=<data dir>`

   The environment carries **no** secret or key. In development (`npm run desktop:dev`) the shell
   spawns `next dev -H 127.0.0.1 -p <port>` with the same environment, except `NODE_ENV`.
5. **Handshake.** The shell sends `hello` with the secret (host-bridge.md). The server runs its
   startup state machine (data-model.md §6) and emits `ready` or `blocked`.
6. **Navigate.** On `ready`, the shell navigates the window to
   `http://127.0.0.1:<port>/__farabi/session?t=<secret>`.
7. **Cookie.** The session route checks `t` against the secret in constant time, sets the cookie,
   and redirects `303` to `/`. Its response carries `Cache-Control: no-store` and
   `Referrer-Policy: no-referrer`.

   ```text
   Set-Cookie: farabi_session=<secret>; HttpOnly; SameSite=Strict; Path=/
   ```

   No `Max-Age` is set, so it is a session cookie. The secret changes every launch anyway.
8. **Timeout.** If the server sends neither `ready` nor `blocked` within **20 s**, the shell shows
   the `fatal` screen.

SC-003 ("ready for input ≤ 3 s") is measured from process start to the first interactive frame
of `/`.

## Request rules (`src/proxy.ts`, desktop mode only)

`proxy.ts` matches every path. It applies these rules only when `FARABI_HOST=tauri`; in web mode
it passes everything through unchanged, so the web app keeps working (FR-025).

| Check | On failure |
|-------|------------|
| The `Host` header is exactly `127.0.0.1:<port>` | `421 Misdirected Request`, empty body |
| Path is `/__farabi/session` | Handled by its route (above); exempt from the next row |
| Cookie `farabi_session` equals the secret, **or** `Authorization: Bearer <secret>` (CLI) | `401`, empty body, no hints |
| State-changing methods (`POST`, `PUT`, `PATCH`, `DELETE`) carry `Origin: http://127.0.0.1:<port>`, or no `Origin` together with a valid Bearer | `403` |

**Response headers on every page:**

```text
Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; connect-src 'self';
  style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; frame-ancestors 'none'
```

The CSP's exact `script-src` is tuned to what Next 16's production build needs. It is verified in
G1 and recorded here when settled. `'wasm-unsafe-eval'` is needed only if PixiJS or any
client-side WASM requires it; PGlite runs on the server, not in the page.

## Window behavior

- **External links** (`http(s)` not on the loopback origin) open in the default browser, never in
  the app window. The shell's navigation handler enforces this.
- **Clipboard, selection and keyboard shortcuts** are the webview's own. The app menu provides
  the standard Edit menu, so ⌘C, ⌘V and ⌘A work on macOS (FR-009).
- **Closing the last window** quits the app on both platforms, sending `shutdown` with reason
  `window-closed`.
