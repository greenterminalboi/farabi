import { describe, expect, it } from "vitest";
import { forgetSecret, redact, registerSecret } from "@/server/host/redact";

describe("redact (SC-008)", () => {
  it("replaces registered secrets wherever they appear", () => {
    const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz";
    registerSecret(key);
    expect(redact(`Authorization: Bearer ${key} and again ${key}.`)).toBe("Authorization: Bearer [redacted] and again [redacted].");
    forgetSecret(key);
    expect(redact(key)).toBe(key);
  });

  it("ignores short values, so ordinary words are never redacted", () => {
    registerSecret("short");
    registerSecret(undefined);
    expect(redact("a short note")).toBe("a short note");
  });
});
