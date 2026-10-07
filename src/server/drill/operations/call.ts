// The generic executor for drill operations (research R4, R5). It never names an operation; a
// guard in tests/unit/f12-operations.test.ts keeps it that way, mirroring v0.2's runner guard.
// It only calls the AI and validates: callers write afterwards, so a failure leaves nothing behind.
import { getAIProvider } from "../../ai";
import { AIUnavailableError } from "../../ai/provider";
import type { DrillOperation } from "./types";

/** The first balanced `{…}` in a reply, skipping code fences and braces inside strings. */
export function extractJson(raw: string): unknown {
  const text = raw.replace(/```[a-zA-Z]*\n?/g, "");
  const start = text.indexOf("{");
  if (start < 0) throw new SyntaxError("The reply has no JSON object");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new SyntaxError("The reply's JSON object isn't closed");
}

function validate<In, Out>(op: DrillOperation<In, Out>, input: In, raw: string): { ok: true; value: Out } | { ok: false; problem: string } {
  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch (err) {
    return { ok: false, problem: err instanceof Error ? err.message : String(err) };
  }
  const result = op.output.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { ok: false, problem: issues.join("; ") };
  }
  const problem = op.check?.(result.data, input) ?? null;
  return problem ? { ok: false, problem } : { ok: true, value: result.data };
}

/**
 * Runs one operation: asks for its JSON, validates it, and on invalid output asks once more with
 * the problem stated. Throws AIUnavailableError when the AI fails or stays invalid.
 */
export async function callOperation<In, Out>(
  op: DrillOperation<In, Out>,
  input: In,
  options: { model: string | null; signal?: AbortSignal },
): Promise<Out> {
  const ask = (prompt: string) =>
    getAIProvider().complete({
      tag: op.id,
      system: op.instruction.system,
      prompt,
      model: options.model,
      effort: op.effort,
      maxTokens: op.maxTokens,
      signal: options.signal,
    });
  const prompt = op.instruction.prompt(input);
  const first = validate(op, input, await ask(prompt));
  if (first.ok) return first.value;
  const retry = `${prompt}\n\nYour previous reply couldn't be used: ${first.problem}. Reply with only the JSON object described above.`;
  const second = validate(op, input, await ask(retry));
  if (second.ok) return second.value;
  throw new AIUnavailableError(`The AI's ${op.id} reply couldn't be used: ${second.problem}`);
}
