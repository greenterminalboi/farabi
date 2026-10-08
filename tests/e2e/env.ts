// Shared by playwright.config.ts and the e2e helpers (feature 11 cut-over): the packaged server
// runs in desktop mode, so every request carries the launch secret as a bearer token.
export const E2E_PORT = process.env.E2E_PORT ?? "3100";
export const E2E_BASE = `http://127.0.0.1:${E2E_PORT}`;
export const E2E_SECRET = "e2e-secret-0123456789abcdefghijklmnopqrstuv";
export const E2E_DATA_DIR = ".farabi-e2e";
export const AUTH = { authorization: `Bearer ${E2E_SECRET}` };
