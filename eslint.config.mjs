import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".next-test/**",
      ".next-scratch/**",
      ".next-desktop/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      "next-env.d.ts",
      ".specify/**",
      ".claude/**",
      "src-tauri/**",
      ".desktop/**",
      ".farabi-dev/**",
    ],
  },
];

export default config;
