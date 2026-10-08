import {
  abortError,
  AIPartialReplyError,
  AIUnavailableError,
  type AIProvider,
  type CompletionInput,
  type DefineInput,
  type DefinitionText,
  type ReplyInput,
  type ReplyOptions,
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
  replyInputs: ReplyInput[];
  lastComplete?: CompletionInput;
  completeInputs: CompletionInput[];
  /** Numbers each completion, so regenerations differ (Feature 9). */
  completeCount: number;
  /** Per-tag responders (Feature 12, C5); other tags get `Fake <tag> #n`. */
  responders: Map<string, FakeResponder>;
};

/** Returns the raw completion for one tag. Runs after the mode's fail/slow behavior. */
export type FakeResponder = (input: CompletionInput, n: number) => string | Promise<string>;
const state = globalThis as unknown as { __farabiFake?: FakeState };
state.__farabiFake ??= { mode: { mode: "ok" }, replyInputs: [], completeInputs: [], completeCount: 0, responders: new Map() };
state.__farabiFake.replyInputs ??= [];
state.__farabiFake.completeInputs ??= [];
state.__farabiFake.completeCount ??= 0;
state.__farabiFake.responders ??= new Map();
const fake = state.__farabiFake;

const CHUNKS = 5;
const CHUNK_DELAY_MS = 40;

export function setFakeMode(mode: FakeMode): void {
  fake.mode = mode;
}

/** Answers completions tagged `tag` with `fn` (replacing any earlier responder for it). */
export function registerFakeCompletion(tag: string, fn: FakeResponder): void {
  fake.responders.set(tag, fn);
}

export function getFakeCalls(): {
  lastReply?: ReplyInput;
  lastSummary?: SummaryInput;
  lastDefine?: DefineInput;
  replyInputs: ReplyInput[];
  lastComplete?: CompletionInput;
  completeInputs: CompletionInput[];
} {
  return {
    lastReply: fake.lastReply,
    lastSummary: fake.lastSummary,
    lastDefine: fake.lastDefine,
    replyInputs: fake.replyInputs,
    lastComplete: fake.lastComplete,
    completeInputs: fake.completeInputs,
  };
}

export function resetFakeCalls(): void {
  fake.replyInputs = [];
  fake.lastReply = undefined;
  fake.lastSummary = undefined;
  fake.lastDefine = undefined;
  fake.completeInputs = [];
  fake.lastComplete = undefined;
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
    // The second sentence is bold, so every reply has a bold span to underline (Feature 5).
    const text = `Echo: ${echoed}. **Containers are mentioned here.**`;
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
    const last = (input.messages.at(-1)?.content ?? input.anchorText ?? "").replace(/\*\*/g, "");
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

  async complete(input: CompletionInput): Promise<string> {
    fake.lastComplete = input;
    fake.completeInputs.push(input);
    await behave(input.signal);
    if (fake.mode.mode === "stall") throw new AIUnavailableError("Fake provider stalled");
    const n = ++fake.completeCount;
    const responder = fake.responders.get(input.tag);
    return responder ? responder(input, n) : `Fake ${input.tag} #${n}`;
  }
}
