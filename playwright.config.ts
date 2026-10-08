import { defineConfig } from "@playwright/test";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://farabi:farabi@127.0.0.1:5432/farabi_test";

// Lanes running e2e side by side pick their own port (E2E_PORT); 3100 stays the default.
const PORT = process.env.E2E_PORT ?? "3100";
// E2E_DESKTOP=1 (npm run test:e2e:desktop, feature 11 T039): the packaged standalone server, as the
// desktop app bundles it, with the desktop's content security policy on, in WebKit (WKWebView's
// engine). It runs against the test database so the suite's resets work unchanged; the PGlite
// store has its own parity gate (G3, npm run test:pglite).
const DESKTOP = process.env.E2E_DESKTOP === "1";
const SERVER_ENV = {
  DATABASE_URL: TEST_DATABASE_URL,
  AI_PROVIDER: "fake",
  FARABI_TEST_HOOKS: "1",
  NEXT_PUBLIC_FARABI_TEST_HOOKS: "1",
  FEEDBACK_DIR: ".feedback-test",
};

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        // Full Chromium with GPU: headless-shell's software WebGL makes canvas timings meaningless.
        channel: "chromium",
        launchOptions: { args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] },
      },
    },
    // The macOS desktop app runs on WKWebView, which is WebKit (feature 11, research R6). Opt-in
    // with E2E_WEBKIT=1 (npm run test:e2e:webkit) so the default run stays as fast as before.
    ...(process.env.E2E_WEBKIT === "1" ? [{ name: "webkit", use: { browserName: "webkit" as const } }] : []),
    ...(DESKTOP ? [{ name: "webkit-desktop", use: { browserName: "webkit" as const } }] : []),
  ],
  webServer: DESKTOP
    ? {
        command:
          `FARABI_STANDALONE=1 NEXT_DIST_DIR=.next-desktop-test npx next build && ` +
          `NEXT_DIST_DIR=.next-desktop-test DESKTOP_SERVER_OUT=.desktop-test/server npx tsx scripts/desktop/prepare-server.ts && ` +
          `node .desktop-test/server/server.js`,
        url: `http://127.0.0.1:${PORT}`,
        reuseExistingServer: false,
        timeout: 300_000,
        env: { ...SERVER_ENV, NEXT_DIST_DIR: ".next-desktop-test", FARABI_CSP: "1", HOSTNAME: "127.0.0.1", PORT },
      }
    : {
        // Production build, so performance checks (SC-004, SC-006) measure the real app.
        command: `npx next build && npx next start -H 127.0.0.1 -p ${PORT}`,
        // A separate build folder, so running tests never breaks a dev server using `.next`.
        url: `http://127.0.0.1:${PORT}`,
        reuseExistingServer: false,
        timeout: 300_000,
        env: { ...SERVER_ENV, NEXT_DIST_DIR: ".next-test" },
      },
});
