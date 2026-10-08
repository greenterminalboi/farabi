import type Anthropic from "@anthropic-ai/sdk";
import { lexiconBlock } from "@/shared/lexicon/block";
import {
  AIUnavailableError,
  type ChatTurn,
  type DefineInput,
  type DefinitionText,
  type ReplyInput,
  type SummaryInput,
} from "./provider";

type TextBlock = Anthropic.Beta.BetaTextBlockParam;
type MessageParam = Anthropic.Beta.BetaMessageParam;

// Stable across every request, so it forms a cacheable prefix.
export const REPLY_SYSTEM = `You are the conversation partner in Farabi, a tool where a person learns by talking through topics and branching off into tangents that catch their interest.

Answer the person's questions clearly and accurately, at the depth they ask for. Follow their lead: respond to what they ask rather than steering them toward new topics or suggesting what to explore next.`;

const escape = (text: string) => text.replace(/</g, "&lt;").replace(/>/g, "&gt;");

function transcript(turns: ChatTurn[]): string {
  return turns
    .map((t) => `<turn speaker="${t.role === "user" ? "person" : "assistant"}">\n${escape(t.content)}\n</turn>`)
    .join("\n");
}

/** Context for a branch: the parent conversation up to the branch point and the highlighted text. */
function branchContext(input: ReplyInput): string | null {
  if (input.anchorText === null) return null;
  const earlier = input.inheritedContext.length
    ? `<earlier_conversation>\n${transcript(input.inheritedContext)}\n</earlier_conversation>\n\n`
    : "";
  return `This conversation is a branch. The person highlighted a passage in an earlier conversation and started this new conversation from it. The earlier conversation, up to the point where they branched, is included as background: this branch is its own conversation, focused on the highlighted passage.

${earlier}<highlighted_passage>
${escape(input.anchorText)}
</highlighted_passage>`;
}

// Information pressure (Feature 6, research R1): one length target per level. The five bands are
// what the user sees; these sentences are internal.
const LENGTH_GUIDANCE: Record<number, string> = {
  1: "Keep your reply to one or two sentences: only the direct answer.",
  2: "Keep your reply to a short paragraph of about 60 words.",
  3: "Keep your reply to about 100 words: the answer plus the single most useful detail.",
  4: "Keep your reply to about 175 words.",
  5: "Aim for about 275 words, explaining the reasoning briefly.",
  6: "Aim for about 400 words.",
  7: "Aim for about 550 words, covering the main aspects with an example where it helps.",
  8: "Aim for about 750 words.",
  9: "Aim for about 1,100 words, covering the topic thoroughly, including nuances and edge cases.",
  10: "Be exhaustive: write as much as the topic warrants.",
};

/** Length guidance for a level; the person's explicit request in a message always wins (Article I). */
export function lengthGuidance(level: number): string {
  return `${LENGTH_GUIDANCE[level]} Match this length unless the person explicitly asks for a different length in their message.`;
}

export function buildReplyRequest(input: ReplyInput): { system: TextBlock[]; messages: MessageParam[] } {
  const system: TextBlock[] = [{ type: "text", text: REPLY_SYSTEM }];
  const context = branchContext(input);
  if (context) system.push({ type: "text", text: context });
  // Last, after the stable prefix, so a level change doesn't invalidate the cached system prompt.
  if (input.pressureLevel !== null) system.push({ type: "text", text: lengthGuidance(input.pressureLevel) });
  // The lexicon terms on the answered message come last of all (Feature 13, contracts/prompt.md):
  // they change per message, so everything before them stays a stable prefix.
  const lexicon = lexiconBlock(input.lexicon ?? []);
  if (lexicon) system.push({ type: "text", text: lexicon });

  const messages: MessageParam[] = input.messages.map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  }));
  if (messages.length === 0 || messages[0].role !== "user" || messages.at(-1)!.role !== "user") {
    throw new Error("A reply needs a conversation that starts and ends with the person's message");
  }
  return { system, messages };
}

export const SUMMARY_SYSTEM = `You write the one-sentence label shown for a conversation on a map of someone's learning.

Write a single sentence, at most about 20 words, saying what the conversation is about now: where it ended up, not how it started. Keep the specific point that makes it distinctive rather than a generic topic name. Reply with only the sentence.`;

export function buildSummaryRequest(input: SummaryInput): { system: string; messages: MessageParam[] } {
  const start = input.anchorText
    ? `<started_from_highlighted_passage>\n${escape(input.anchorText)}\n</started_from_highlighted_passage>\n\n`
    : "";
  return {
    system: SUMMARY_SYSTEM,
    messages: [
      {
        role: "user",
        content: `${start}<conversation>\n${transcript(input.messages)}\n</conversation>\n\nWrite the label.`,
      },
    ],
  };
}

/** Keeps the first line of the model's answer, with surrounding quotes and whitespace removed. */
export function cleanSummary(text: string): string {
  const line = text.trim().split(/\n+/)[0] ?? "";
  return line.replace(/^["“'`]+|["”'`]+$/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Single-prompt form for Claude Code headless mode, which takes one prompt rather than a
 * message list: the conversation so far is sent as a transcript.
 */
export function buildHeadlessReply(input: ReplyInput): { system: string; prompt: string } {
  const { system, messages } = buildReplyRequest(input);
  const turns: ChatTurn[] = messages.map((m) => ({
    role: m.role === "user" ? "user" : "ai",
    content: m.content as string,
  }));
  return {
    system: [
      ...system.map((b) => b.text),
      "The conversation so far is given as a transcript. Write only your next reply to the person, as plain conversational text without speaker labels or tags.",
    ].join("\n\n"),
    prompt: `<conversation>\n${transcript(turns)}\n</conversation>`,
  };
}

export function buildHeadlessSummary(input: SummaryInput): { system: string; prompt: string } {
  const { system, messages } = buildSummaryRequest(input);
  return { system, prompt: messages[0].content as string };
}

export const DEFINE_SYSTEM = `You write short glossary cards for a person's learning notes. Each card has exactly two parts:

GENERAL: what the term means in general, in at most two sentences.
IN THIS CONVERSATION: how the term is used in the conversation you are given, in one sentence, based only on that conversation.

Reply with exactly those two labelled lines and nothing else.`;

export function buildDefineRequest(input: DefineInput): { system: string; prompt: string } {
  return {
    system: DEFINE_SYSTEM,
    prompt: `<term>${escape(input.term)}</term>

<captured_from>
${escape(input.sourceMessage.content)}
</captured_from>

<conversation>
${transcript(input.messages)}
</conversation>

Write the card for the term.`,
  };
}

/** Parses the two labelled parts of a definition card. */
export function parseDefinition(text: string): DefinitionText {
  const general = /GENERAL:\s*([\s\S]*?)(?=\n\s*IN THIS CONVERSATION:|$)/i.exec(text)?.[1];
  const usage = /IN THIS CONVERSATION:\s*([\s\S]*)$/i.exec(text)?.[1];
  const clean = (s?: string) => (s ?? "").replace(/\s+/g, " ").trim();
  if (!clean(general) || !clean(usage)) throw new AIUnavailableError("The definition came back in an unexpected format");
  return { general: clean(general), usage: clean(usage) };
}
