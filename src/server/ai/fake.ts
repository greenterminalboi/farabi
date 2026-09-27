import { AIUnavailableError, type AIProvider, type ReplyInput, type SummaryInput } from "./provider";

export type FakeMode = { mode: "ok" | "fail" | "slow"; delayMs?: number };

// Kept on globalThis so route handlers and tests share one instance across module reloads.
const state = globalThis as unknown as {
  __farabiFake?: { mode: FakeMode; lastReply?: ReplyInput; lastSummary?: SummaryInput };
};
state.__farabiFake ??= { mode: { mode: "ok" } };
const fake = state.__farabiFake;

export function setFakeMode(mode: FakeMode): void {
  fake.mode = mode;
}

export function getFakeCalls(): { lastReply?: ReplyInput; lastSummary?: SummaryInput } {
  return { lastReply: fake.lastReply, lastSummary: fake.lastSummary };
}

async function behave(): Promise<void> {
  if (fake.mode.mode === "fail") throw new AIUnavailableError("Fake provider set to fail");
  if (fake.mode.mode === "slow") {
    await new Promise((resolve) => setTimeout(resolve, fake.mode.delayMs ?? 5000));
  }
}

export class FakeAIProvider implements AIProvider {
  async reply(input: ReplyInput): Promise<string> {
    fake.lastReply = input;
    await behave();
    const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
    const echoed = (lastUser?.content ?? "").trim().replace(/[.!?]+$/, "");
    return `Echo: ${echoed}. Containers are mentioned here.`;
  }

  async summarize(input: SummaryInput): Promise<string> {
    fake.lastSummary = input;
    await behave();
    const last = input.messages.at(-1)?.content ?? input.anchorText ?? "";
    const words = last.trim().split(/\s+/).filter(Boolean).slice(-6).join(" ");
    return `About: ${words.replace(/[.!?]+$/, "")}.`;
  }
}
