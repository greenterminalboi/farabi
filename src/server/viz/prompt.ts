// The generation instructions (feature 014, FR-017, research R7). The guide mirrors
// contracts/scene-v1.md in the fewest words that still let a model produce a valid scene.
import { MAX_ELEMENTS, MAX_STEPS } from "@/viz/schema";

export type VizFamilyHint = "auto" | "code" | "algorithm" | "argument";

export type VizPromptInput = { family: VizFamilyHint; text: string };

export const SCENE_GUIDE = `A scene is one JSON object:
{"version":1,"title":"…(≤120)","description":"…one or two sentences (≤1000)","family":"code"|"algorithm"|"argument"|"general","origin":"ai-suggested","width":800,"height":450,"elements":[…],"steps":[…]}

Elements (ids: letter first, then letters/digits/-/_, ≤40 chars, unique). x,y = top-left in a width×height canvas (default 800×450). Optional on all: "hidden":true (revealed later with show), "tone".
- {"type":"box","id","x","y","label","w"?,"h"?,"shape"?:"rect"|"round"|"ellipse","role"?:"claim"|"premise"|"evidence"|"conclusion"|"note"}  (w ≤ 260; text wraps)
- {"type":"text","id","x","y","text","size"?:"sm"|"md"|"lg","align"?:"start"|"middle"|"end","w"?}
- {"type":"connector","id","from","to","relation"?:"plain"|"supports"|"attacks"|"conflicts","label"?,"directed"?}  (joins two non-connector elements; no x,y)
- {"type":"code","id","x","y","lines":["…"],"language"?,"title"?,"w"?}  (1–80 lines, each the exact source line)
- {"type":"array","id","x","y","values":[…],"label"?,"cellWidth"?,"pointers"?:[{"name","index"}]}  (≤40 values)
- {"type":"panel","id","x","y","rows":[{"key","value"}],"label"?,"w"?}  (variables; rows can start empty)
- {"type":"stack","id","x","y","frames":["…"],"label"?,"w"?}  (bottom first)
- {"type":"graph","id","x","y","w","h","layout"?:"tree"|"layered"|"circle"|"row","root"?,"nodes":[{"id","label","hidden"?}],"edges":[{"id"?,"from","to","label"?,"relation"?,"hidden"?}]}  (an edge's id defaults to "from->to")
Tones: "default","accent","good","bad","partial","muted","ai".

Steps: [{"caption":"…what happens, plain words (≤300)","actions":[…]}]. Each step shows the state after its actions. Actions:
- {"op":"highlight","target","part"?,"tone"?}   {"op":"clear","target"?,"part"?}
- {"op":"set","target","part"?,"value"}   (box label, text, array cell by index, panel row by key (added if new), stack frame by index, graph node label by id)
- {"op":"swap","target","i","j"}   {"op":"compare","target","i","j"}   (arrays; marks last one step)
- {"op":"pointer","target","name","index"}   (array pointer; index null hides it)
- {"op":"push","target","label"}   {"op":"pop","target"}   (stacks)
- {"op":"show","target","part"?}   {"op":"hide","target","part"?}   (parts: graph node/edge ids, panel row keys)
- {"op":"move","target","x","y"}
- {"op":"line","target","line","tokens"?:[{"start","end"}]}   (code: current line, 1-based; token columns 0-based, end exclusive)
Parts: array cell index, code line number, panel row key, stack frame index (0 = bottom), graph node or edge id.
Limits: ≤ ${MAX_ELEMENTS} elements (graph nodes count), ≤ ${MAX_STEPS} steps, ≤ 50 actions per step. Every target and part must exist when used. No other fields.

Recipes:
- code: a "code" element with the exact lines, a "panel" for variables, a "stack" if there are calls; one step per executed line: "line" + "set" for changed variables + push/pop.
- algorithm: an "array" (sorting, searching, pointers) or a "graph" (trees, graphs, traversals); one step per comparison, swap, visit or pointer move.
- argument: "box" elements with roles for each statement, "connector"s with supports/attacks, and a "conflicts" connector between statements that can't both hold; reveal them step by step.`;

export const VIZ_SYSTEM = [
  "You turn source text into a visualization scene for a learning app: an animated, step-by-step diagram.",
  "Depict only what is in the given text: its code, its algorithm, or its statements and how they relate.",
  "Never add facts, examples or claims that are not in the text. Never say which side of a contradiction is right or wrong, and never judge the text.",
  "Never say anything about the person who wrote the text, their skill or their thinking.",
  "Captions describe what the diagram shows at that step, in plain words.",
  "If the text is code, trace a plausible execution of it with the inputs it contains; if it has none, trace the structure without inventing values.",
  "",
  SCENE_GUIDE,
  "",
  "Reply with only the JSON object. No prose, no code fences.",
].join("\n");

const FAMILY_HINT: Record<VizFamilyHint, string> = {
  auto: "Choose the family that fits the text best.",
  code: 'The text is code: use family "code".',
  algorithm: 'The text describes an algorithm: use family "algorithm".',
  argument: 'The text is statements that relate or conflict: use family "argument".',
};

export function vizPrompt(input: VizPromptInput): string {
  return [`Make a scene for the text below. ${FAMILY_HINT[input.family]}`, `<input>\n${JSON.stringify(input, null, 2)}\n</input>`].join("\n\n");
}

/** Reads the `<input>` block back (fake responder only). */
export function readVizInput(prompt: string): VizPromptInput {
  const match = /<input>\n([\s\S]*)\n<\/input>/.exec(prompt);
  if (!match) throw new Error("No <input> block in the prompt");
  return JSON.parse(match[1]) as VizPromptInput;
}
