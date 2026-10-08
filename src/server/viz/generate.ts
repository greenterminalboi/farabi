// Scene generation from text (feature 014, US3, FR-013 to FR-017, research R7). Mirrors the drill
// executor (src/server/drill/operations/call.ts): ask, validate, retry once with the problem stated,
// otherwise fail. Nothing is stored either way. The caller (the route) runs providerReady() first.
import { getAIProvider } from "../ai";
import { AIUnavailableError, isAbortError } from "../ai/provider";
import { extractJson } from "../drill/operations/call";
import { InvalidRequestError } from "../errors";
import { parseScene } from "@/viz/validate";
import type { Scene } from "@/viz/schema";
import { VIZ_TAG } from "./fake";
import { VIZ_SYSTEM, type VizFamilyHint, vizPrompt } from "./prompt";

export const MAX_SOURCE_CHARS = 20_000;
export const VIZ_FAMILIES: VizFamilyHint[] = ["auto", "code", "algorithm", "argument"];

export class VizGenerationError extends Error {
  readonly code = "viz_unavailable";
  constructor(readonly detail: string) {
    super("The AI couldn't produce a usable visualization. Nothing was created. Try again.");
  }
}

export type GenerateInput = { text: string; family?: VizFamilyHint };
export type GenerateOptions = { model?: string | null; signal?: AbortSignal };

type Checked = { ok: true; scene: Scene } | { ok: false; problem: string };

/** Extracts and validates one reply; the scene is always marked AI-suggested (FR-016). */
export function checkReply(raw: string): Checked {
  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch (err) {
    return { ok: false, problem: err instanceof Error ? err.message : String(err) };
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) (parsed as Record<string, unknown>).origin = "ai-suggested";
  const result = parseScene(parsed);
  if (result.ok) return { ok: true, scene: result.scene };
  return { ok: false, problem: result.problems.slice(0, 8).map((p) => `${p.path}: ${p.message}`).join("; ") };
}

export function validateInput(input: GenerateInput): { text: string; family: VizFamilyHint } {
  const text = (input.text ?? "").trim();
  if (!text) throw new InvalidRequestError("Paste some text to visualize.");
  if (text.length > MAX_SOURCE_CHARS) throw new InvalidRequestError(`The text is too long (${text.length} characters; at most ${MAX_SOURCE_CHARS}).`);
  const family = input.family ?? "auto";
  if (!VIZ_FAMILIES.includes(family)) throw new InvalidRequestError(`Unknown family "${family}"`);
  return { text, family };
}

export async function generateScene(input: GenerateInput, options: GenerateOptions = {}): Promise<Scene> {
  const { text, family } = validateInput(input);
  const ask = async (prompt: string) => {
    try {
      return await getAIProvider().complete({
        tag: VIZ_TAG,
        system: VIZ_SYSTEM,
        prompt,
        model: options.model ?? null,
        effort: "medium",
        maxTokens: 8000,
        signal: options.signal,
      });
    } catch (err) {
      if (isAbortError(err)) throw err;
      if (err instanceof AIUnavailableError) throw new VizGenerationError(err.message);
      throw err;
    }
  };
  const prompt = vizPrompt({ family, text });
  const first = checkReply(await ask(prompt));
  if (first.ok) return first.scene;
  const retry = `${prompt}\n\nYour previous reply couldn't be used: ${first.problem}. Reply with only the corrected JSON object.`;
  const second = checkReply(await ask(retry));
  if (second.ok) return second.scene;
  throw new VizGenerationError(second.problem);
}
