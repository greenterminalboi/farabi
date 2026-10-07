import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "@/server/db/migrationList";

describe("migration list", () => {
  it("names every file in the migrations folder, and nothing else", () => {
    const folder = path.resolve(import.meta.dirname, "../../src/server/db/migrations");
    const files = readdirSync(folder)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => f.replace(/\.ts$/, ""))
      .sort();
    expect(Object.keys(MIGRATIONS).sort()).toEqual(files);
  });
});
