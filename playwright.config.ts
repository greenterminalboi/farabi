import { defineConfig } from "@playwright/test";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://farabi:farabi@127.0.0.1:5432/farabi_test";

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    // Full Chromium with GPU: headless-shell's software WebGL makes canvas timings meaningless.
    channel: "chromium",
    launchOptions: { args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] },
  },
  webServer: {
    // Production build, so performance checks (SC-004, SC-006) measure the real app.
    command: "npx next build && npx next start -H 127.0.0.1 -p 3100",
    // A separate build folder, so running tests never breaks a dev server using `.next`.
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      AI_PROVIDER: "fake",
      SUMMARY_TRIGGER: "reply",
      FARABI_TEST_HOOKS: "1",
      NEXT_PUBLIC_FARABI_TEST_HOOKS: "1",
      NEXT_DIST_DIR: ".next-test",
      FEEDBACK_DIR: ".feedback-test",
    },
  },
});
