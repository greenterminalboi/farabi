import { afterEach, describe, expect, it } from "vitest";
import { resolveReplyModel } from "@/server/ai";
import { FALLBACK_BETA, replyParams } from "@/server/ai/claude";
import { headlessArgs } from "@/server/ai/claudeCode";
import type { ReplyInput } from "@/server/ai/provider";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

const input = (model: string | null): ReplyInput => ({
  inheritedContext: [],
  anchorText: null,
  messages: [{ role: "user", content: "hi" }],
  pressureLevel: 8,
  model,
});

describe("Claude API replies use the chosen model (Feature 6)", () => {
  it("sends fallbacks only for models that support them", () => {
    for (const model of ["claude-opus-5", "claude-opus-5-5", "claude-fable-5-1"]) {
      expect(replyParams(input(model))).toMatchObject({ model, betas: [FALLBACK_BETA], fallbacks: "default" });
    }
    for (const model of ["claude-sonnet-5", "claude-haiku-4-5"]) {
      const params = replyParams(input(model));
      expect(params.model).toBe(model);
      expect(params).not.toHaveProperty("betas");
      expect(params).not.toHaveProperty("fallbacks");
    }
  });

  it("uses the configured model when none is chosen", () => {
    expect(replyParams(input(null)).model).toBe(process.env.CLAUDE_MODEL ?? "claude-opus-5");
  });
});

describe("Claude Code replies pass --model", () => {
  it("passes the chosen model", () => {
    const args = headlessArgs("sys", { model: "claude-sonnet-5" });
    expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2)).toEqual(["--model", "claude-sonnet-5"]);
  });

  it("falls back to CLAUDE_CODE_MODEL, then to the CLI's own default", () => {
    process.env.CLAUDE_CODE_MODEL = "claude-opus-5";
    expect(headlessArgs("sys", { model: null })).toContain("claude-opus-5");
    delete process.env.CLAUDE_CODE_MODEL;
    expect(headlessArgs("sys", { model: null })).not.toContain("--model");
  });
});

describe("resolveReplyModel", () => {
  it("resolves Default per AI setup and passes a chosen model through", () => {
    process.env.AI_PROVIDER = "claude";
    delete process.env.CLAUDE_MODEL;
    expect(resolveReplyModel("default")).toBe("claude-opus-5");
    process.env.CLAUDE_MODEL = "claude-fable-5-1";
    expect(resolveReplyModel("default")).toBe("claude-fable-5-1");

    process.env.AI_PROVIDER = "claude-code";
    delete process.env.CLAUDE_CODE_MODEL;
    expect(resolveReplyModel("default")).toBeNull();
    process.env.CLAUDE_CODE_MODEL = "claude-opus-5";
    expect(resolveReplyModel("default")).toBe("claude-opus-5");

    process.env.AI_PROVIDER = "fake";
    expect(resolveReplyModel("default")).toBeNull();
    expect(resolveReplyModel("claude-haiku-4-5")).toBe("claude-haiku-4-5");
  });
});
