// Scene generation from text (feature 014, US3, FR-013 to FR-017, research R7). The generation is
// an operation run by the drill lane's generic executor (src/server/drill/operations/call.ts): ask,
// validate, retry once with the problem stated, otherwise fail. That executor is the one place
// besides src/server/{ai,functions} allowed to call the provider (constitution guard, feature 10).
// Nothing is stored either way. The caller (the route) runs providerReady() first.
import { z } from "zod";
import { AIUnavailableError } from "../ai/provider";
import { callOperation } from "../drill/operations/call";
import type { DrillOperation } from "../drill/operations/types";
import { InvalidRequestError } from "../errors";
import { parseScene } from "@/viz/validate";
import type { Scene } from "@/viz/schema";
import { fakeVizResponder, VIZ_TAG } from "./fake";
import { VIZ_SYSTEM, type VizFamilyHint, type VizPromptInput, vizPrompt } from "./prompt";

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

/**
 * The reply as a scene: always marked AI-suggested whatever the AI wrote (FR-016), then
 * parseScene's structure, reference and step checks, reported with their paths.
 */
export const GeneratedScene: z.ZodType<Scene> = z.unknown().transform((value, ctx) => {
  if (value && typeof value === "object" && !Array.isArray(value)) (value as Record<string, unknown>).origin = "ai-suggested";
  const result = parseScene(value);
  if (result.ok) return result.scene;
  ctx.addIssue({ code: "custom", message: result.problems.slice(0, 8).map((p) => `${p.path}: ${p.message}`).join("; ") });
  return z.NEVER;
});

export const vizGenerate: DrillOperation<VizPromptInput, Scene> = {
  id: VIZ_TAG,
  version: 1,
  effort: "medium",
  maxTokens: 8000,
  instruction: { system: VIZ_SYSTEM, prompt: vizPrompt },
  output: GeneratedScene,
  fake: fakeVizResponder,
};

export function validateInput(input: GenerateInput): VizPromptInput {
  const text = (input.text ?? "").trim();
  if (!text) throw new InvalidRequestError("Paste some text to visualize.");
  if (text.length > MAX_SOURCE_CHARS) throw new InvalidRequestError(`The text is too long (${text.length} characters; at most ${MAX_SOURCE_CHARS}).`);
  const family = input.family ?? "auto";
  if (!VIZ_FAMILIES.includes(family)) throw new InvalidRequestError(`Unknown family "${family}"`);
  return { text, family };
}

export async function generateScene(input: GenerateInput, options: GenerateOptions = {}): Promise<Scene> {
  const prompt = validateInput(input);
  try {
    return await callOperation(vizGenerate, prompt, { model: options.model ?? null, signal: options.signal });
  } catch (err) {
    // Provider failures and replies still invalid after the retry; aborts pass through.
    if (err instanceof AIUnavailableError) throw new VizGenerationError(err.message);
    throw err;
  }
}
