# Quickstart: Validating Farabi as a Native Desktop App (Feature 011)

These are run-and-check scenarios that prove the feature works end to end. They link to the
contracts and data model rather than repeating them. V1–V3 are the gates and run first (plan.md,
"Gates").

## Prerequisites

**Developer machine (macOS)**:

- Node 24, npm, Rust stable and the Tauri CLI (`npm i` installs `@tauri-apps/cli`);
- Xcode command-line tools;
- Docker, only for the `pg` side of the parity matrix until cut-over.

**Windows**: a Windows 10 21H2+ or 11 x64 machine or VM with GPU acceleration, for V5 and V11.
The CI runner `windows-latest` covers the automated parts.

**Clean machines** for V4 and V11: a macOS user account and a Windows VM with **no** Node,
Docker, Postgres or Claude Code installed.

## V1 – Gate G1: shell spike (macOS and Windows)

```bash
npm run desktop:dev          # tauri dev; shell spawns next dev with the host bridge
npm run seed:large -- --data-dir .farabi-dev   # with the app quit first (cli.md exit 2 otherwise)
```

1. Launch. The window shows the starting page and then the canvas within 3 s. No browser opens.
2. From another terminal, run `curl -i http://127.0.0.1:<port>/api/settings` (the port is in
   `.farabi-dev/runtime.json`). Expect `401`. With `-H 'Host: localhost:<port>'`, expect `421`.
   See launch-session.md.
3. Send a message with the fake provider. Text streams in token by token. **Stop** keeps the
   partial text.
4. Open the large project and pan for 10 s. The in-page frame probe reports **p95 ≤ 16.7 ms**
   (SC-005).

**Pass**: all four hold on macOS (WKWebView) and Windows (WebView2). If step 4 fails on macOS,
stop and review with the owner (research R6).

## V2 – Gate G2: store durability (research R2)

```bash
npm run desktop:durability -- --kills 50            # G2a: SIGKILL the server mid-write
npm run desktop:durability -- --fsync-probe         # G2b: run under dtruss (macOS) / Process Monitor (Windows)
```

- **G2a**: 50/50 runs reopen the store, consistency queries pass, and zero committed rows are
  lost (SC-007).
- **G2b**: the report says whether `fsync`/`F_FULLFSYNC` reaches the disk on commit, and whether
  PGlite can start without `-F`.
- **G2c** is manual: run `npm run desktop:durability -- --writer-only` in a macOS VM and a Windows
  VM, hard-reset the VM 10 times, and check after each reboot with `--verify`.

**Expected**: G2a passes. If G2b or G2c fails, log it to the coordinator for the owner's choice
(research R2 options a and b) before the storage tasks continue.

## V3 – Gate G3: backend parity

```bash
docker compose up -d && STORE=pg npm test
STORE=pglite npm test        # no Docker needed
```

**Expected**: both runs pass with identical test counts. This covers the `real`, `timestamptz`
and `jsonb` parsing in data-model.md §1.

## V4 – Zero-setup install (US1, SC-001, SC-002)

```bash
npm run desktop:build        # prints installer path + size
```

1. Check the size: the `.dmg` and the NSIS `.exe` are each **< 100 MB** (SC-002).
2. On a clean machine, install it and pass the unsigned-app warning using
   `docs/desktop-install.md`.
3. Launch and time from launch to the first reply with the fake provider: **< 3 min** from the
   installer download, and **≤ 3 s** to ready for input (SC-003).
4. Confirm nothing else was installed, and that the data dir was created (data-model.md §2).

## V5 – Parity (US2, SC-004, SC-005)

```bash
npx playwright test --project=webkit           # against the packaged standalone server on PGlite
npx playwright test --project=desktop-windows  # on Windows: the built app, attached over CDP
npm run test:desktop                           # WebdriverIO native smoke, macOS + Windows
```

**Expected**: 100% pass on each. Repeat V1 step 4 on the Windows reference laptop.

Check selection and copy by hand: select text at the closest and furthest zoom, then ⌘C or Ctrl+C
and paste elsewhere (FR-009).

## V6 – Import the web-app database (US3, SC-006)

1. With the web app's Postgres running and fully migrated, open the fresh desktop app and go to
   **Settings → Data → Import from the web app**. Run **Check**: `ready: true`, with counts
   (http-additions.md, "Import").
2. Run **Import**. The result is `succeeded` and `checksumsMatch: true`.
3. Spot check: open a project and confirm the provenance badges and feedback item states match
   the web app.
4. Run **Import** again. The app says "already imported on <date>", and nothing changes.
5. **Failure path**: in a copy of the source, corrupt one row's JSON (for example with a
   `UPDATE … SET value = '…'` that breaks the destination `CHECK`). The import reports `failed`,
   and the destination is still empty.

## V7 – Settings and API key (US4, SC-008)

1. With no key set and the provider set to Claude API, send a message. The app says a key is
   needed, links to the setting, and keeps the composer text. No question edge is created.
2. Save the key with **Verify**. Send a message, and it streams.
3. Run `grep -r "<first 12 chars of key>" "<data dir>" "<log dir>" "<export dir>"`. Expect **no
   matches** (SC-008).
4. Restart the app. The provider, model and feedback folder are kept.

## V8 – Claude Code provider (FR-012, FR-012a)

1. With Claude Code installed and signed in, launch the app **from the Dock or Start menu**, not
   a terminal. Settings shows *Found · signed in* with its path. Select it and send a message:
   the reply streams.
2. Run `claude logout` (or rename the binary). After a refresh, Settings shows *signed out* or
   *Not found*. Sending offers the API provider, and the message is kept.
3. On Windows, repeat step 1 with an npm-installed `claude.cmd`.

## V9 – Feedback loop (US5, FR-020)

1. **Settings → Feedback export folder → Choose…** and pick the repo's `feedback/`. Log an item
   with a screenshot. `feedback/FEEDBACK.md` and `feedback/attachments/…` appear.
2. With the app open, run `npm run feedback:addressed -- <id>`. It prints "Marked … addressed",
   and the app shows the item as addressed.
3. Quit the app and repeat on another item. The CLI opens the closed store directly with the same
   result (cli.md).
4. Rename the export folder, then log an item. It is saved, and the app warns that the export
   could not be written.

## V10 – Upgrades, newer data and backups (US6, FR-018)

1. Install build N and create data. Install build N+1, which has one new migration. On launch,
   `backups/<ts>-pre-<migration>/` exists and the data is intact.
2. Reinstall build N over N+1. The window shows the "data from a newer Farabi" screen, and the
   store's files are unchanged (compare their mtimes).

## V11 – Native behaviors (US6, FR-005, FR-006, FR-023)

1. Launch twice. Only one window opens, and it comes to the front.
2. Move and resize the window, maximize it, and restart. The state is restored. Move it to a
   second monitor and unplug that monitor. On the next launch, the window appears on the
   remaining screen.
3. Uninstall without ticking the box. The data dir remains. Reinstall, and the data is back.

## V12 – Crash and offline edge cases

1. Force-quit (`kill -9` / Task Manager) mid-reply and relaunch. The partial reply is kept, and
   the store opens.
2. Disconnect from the network. Projects browse and edit normally. A send fails with a clear
   message, and the text is kept.
