// Deterministic fake generation (FR-018): built from the engine's templates, so tests and the dev
// page get a valid scene for each family without any real AI call.
import { registerFakeCompletion } from "../ai/fake";
import type { CompletionInput } from "../ai/provider";
import { arraySort, codeTrace, contradiction } from "@/viz/templates";
import type { Scene } from "@/viz/schema";
import { readVizInput } from "./prompt";

export const VIZ_TAG = "viz_generate";

const looksLikeCode = (text: string) => /[{};]|=>|\bdef\s|\bfunction\b|\breturn\b|^\s*(for|while|if)\b.*:\s*$/m.test(text);

export function fakeScene(family: string, text: string): Scene {
  const numbers = (text.match(/-?\d+(\.\d+)?/g) ?? []).map(Number).filter(Number.isFinite);
  const kind = family !== "auto" ? family : looksLikeCode(text) ? "code" : numbers.length >= 3 ? "algorithm" : "argument";
  if (kind === "code") {
    const lines = text.replace(/\r\n/g, "\n").split("\n").slice(0, 80);
    const trace = lines
      .map((line, i) => ({ line: i + 1, text: line.trim() }))
      .filter((l) => l.text)
      .slice(0, 30)
      .map((l) => ({ line: l.line, caption: `Line ${l.line}: ${l.text.slice(0, 120)}` }));
    return codeTrace({ title: "Step-through of the pasted code", source: lines.join("\n"), trace, origin: "ai-suggested" });
  }
  if (kind === "algorithm") {
    const values = (numbers.length >= 2 ? numbers : [5, 3, 8, 1]).slice(0, 8).map((n) => Math.round(n));
    return arraySort({ values, algorithm: "bubble", origin: "ai-suggested" });
  }
  const parts = text
    .split(/\n+|\s+(?:vs\.?|versus)\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const a = parts[0] ?? text.trim();
  const b = parts[1] ?? "The opposite of the first statement.";
  return contradiction({ title: "Two statements from the text", a, b, origin: "ai-suggested" });
}

export function fakeVizResponder(input: CompletionInput): string {
  const { family, text } = readVizInput(input.prompt);
  return JSON.stringify(fakeScene(family, text));
}

let installed = false;

/** Registers the fake responder for `viz_generate`. Idempotent; harmless with a real provider. */
export function installVizFakes(force = false): void {
  if (installed && !force) return;
  installed = true;
  registerFakeCompletion(VIZ_TAG, fakeVizResponder);
}
