import {
  abortError,
  AIPartialReplyError,
  AIUnavailableError,
  type AIProvider,
  type DefineInput,
  type DefinitionText,
  type ReplyInput,
  type ReplyOptions,
  type SuggestSpansInput,
  type SummaryInput,
} from "./provider";

export type FakeMode = {
  mode: "ok" | "fail" | "slow" | "stall";
  delayMs?: number;
  /** Pause between streamed chunks (default 40 ms); larger values make replies stoppable in tests. */
  chunkDelayMs?: number;
};

// Kept on globalThis so route handlers and tests share one instance across module reloads.
type FakeState = {
  mode: FakeMode;
  lastReply?: ReplyInput;
  lastSummary?: SummaryInput;
  lastDefine?: DefineInput;
  lastSuggest?: SuggestSpansInput;
  suggestCalls: number;
  replyInputs: ReplyInput[];
};
const state = globalThis as unknown as { __farabiFake?: FakeState };
state.__farabiFake ??= { mode: { mode: "ok" }, replyInputs: [], suggestCalls: 0 };
state.__farabiFake.replyInputs ??= [];
state.__farabiFake.suggestCalls ??= 0;
const fake = state.__farabiFake;

const CHUNKS = 5;
const CHUNK_DELAY_MS = 40;

export function setFakeMode(mode: FakeMode): void {
  fake.mode = mode;
}

export function getFakeCalls(): {
  lastReply?: ReplyInput;
  lastSummary?: SummaryInput;
  lastDefine?: DefineInput;
  lastSuggest?: SuggestSpansInput;
  suggestCalls: number;
  replyInputs: ReplyInput[];
} {
  return {
    lastReply: fake.lastReply,
    lastSummary: fake.lastSummary,
    lastDefine: fake.lastDefine,
    lastSuggest: fake.lastSuggest,
    suggestCalls: fake.suggestCalls,
    replyInputs: fake.replyInputs,
  };
}

export function resetFakeCalls(): void {
  fake.replyInputs = [];
  fake.lastReply = undefined;
  fake.lastSummary = undefined;
  fake.lastDefine = undefined;
  fake.lastSuggest = undefined;
  fake.suggestCalls = 0;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(abortError());
    });
  });

async function behave(signal?: AbortSignal): Promise<void> {
  if (fake.mode.mode === "fail") throw new AIUnavailableError("Fake provider set to fail");
  if (fake.mode.mode === "slow") await sleep(fake.mode.delayMs ?? 5000, signal);
}

/** Splits text into n roughly equal pieces. */
function chunk(text: string, n: number): string[] {
  const size = Math.ceil(text.length / n);
  return Array.from({ length: n }, (_, i) => text.slice(i * size, (i + 1) * size)).filter(Boolean);
}

export class FakeAIProvider implements AIProvider {
  async reply(input: ReplyInput, options?: ReplyOptions): Promise<string> {
    fake.lastReply = input;
    fake.replyInputs.push(input);
    await behave(input.signal);
    const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
    const echoed = (lastUser?.content ?? "").trim().replace(/[.!?]+$/, "");
    const text = `Echo: ${echoed}. Containers are mentioned here.`;
    const pieces = chunk(text, CHUNKS);
    let sent = "";
    for (const [i, piece] of pieces.entries()) {
      if (fake.mode.mode === "stall" && i === 2) throw new AIPartialReplyError(sent);
      await sleep(fake.mode.chunkDelayMs ?? CHUNK_DELAY_MS, input.signal);
      options?.onText?.(piece);
      sent += piece;
    }
    return text;
  }

  async summarize(input: SummaryInput): Promise<string> {
    fake.lastSummary = input;
    await behave(input.signal);
    const last = input.messages.at(-1)?.content ?? input.anchorText ?? "";
    const words = last.trim().split(/\s+/).filter(Boolean).slice(-6).join(" ");
    return `About: ${words.replace(/[.!?]+$/, "")}.`;
  }

  async define(input: DefineInput): Promise<DefinitionText> {
    fake.lastDefine = input;
    await behave(input.signal);
    return {
      general: `General meaning of ${input.term}.`,
      usage: `Here, ${input.term} refers to what the conversation discussed.`,
    };
  }

  /** Every sentence of 2–20 words except the "Echo:" one, first 3 (contracts/ai-provider.md). */
  async suggestSpans(input: SuggestSpansInput): Promise<string[]> {
    fake.lastSuggest = input;
    fake.suggestCalls++;
    await behave(input.signal);
    return input.text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => !s.startsWith("Echo:"))
      .filter((s) => {
        const words = s.split(/\s+/).filter(Boolean).length;
        return words >= 2 && words <= 20;
      })
      .slice(0, 3);
  }
}
