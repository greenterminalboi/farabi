import { defineConfig } from "@playwright/test";
import { AUTH, E2E_BASE, E2E_DATA_DIR, E2E_PORT, E2E_SECRET } from "./tests/e2e/env";

// Feature 11: e2e drives the app as it ships. The standalone server is built with test hooks,
// prepared the way the installer bundles it, and started in desktop mode by a stand-in for the
// Tauri shell (scripts/desktop/e2e-server.ts) on a fresh data folder, so the session rules and the
// content security policy apply. WebKit is the macOS app's engine (WKWebView); Chromium stands in
// for Windows' WebView2. Lanes running e2e side by side pick their own port with E2E_PORT.
export default defineConfig({
  testDir: "tests/e2e",
  testIgnore: ["env.ts", "helpers.ts", "drill-helpers.ts"],
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  use: {
    baseURL: E2E_BASE,
    extraHTTPHeaders: AUTH,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "webkit", use: { browserName: "webkit" } },
    {
      name: "chromium",
      use: {
        // Full Chromium with GPU: headless-shell's software WebGL makes canvas timings meaningless.
        channel: "chromium",
        launchOptions: { args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] },
      },
    },
  ],
  webServer: {
    command:
      `FARABI_STANDALONE=1 NEXT_DIST_DIR=.next-desktop-test npx next build && ` +
      `NEXT_DIST_DIR=.next-desktop-test DESKTOP_SERVER_OUT=.desktop-test/server npx tsx scripts/desktop/prepare-server.ts && ` +
      `npx tsx scripts/desktop/e2e-server.ts .desktop-test/server ${E2E_DATA_DIR} ${E2E_PORT} ${E2E_SECRET}`,
    url: E2E_BASE,
    reuseExistingServer: false,
    timeout: 300_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 8000 },
    env: {
      AI_PROVIDER: "fake",
      FARABI_TEST_HOOKS: "1",
      NEXT_PUBLIC_FARABI_TEST_HOOKS: "1",
      NEXT_DIST_DIR: ".next-desktop-test",
    },
  },
});
