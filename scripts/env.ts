import { existsSync } from "node:fs";
import path from "node:path";

/** Loads .env.local then .env.example into process.env without overriding existing values. */
export function loadEnv(): void {
  for (const file of [".env.local", ".env.example"]) {
    const full = path.resolve(import.meta.dirname, "..", file);
    if (existsSync(full)) process.loadEnvFile(full);
  }
}
