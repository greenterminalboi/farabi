// The scene description, version 1 (feature 014, contracts/scene-v1.md). Pure: no DOM, no server
// imports, so the same validation runs in the browser, on the server and in tests.
import { z } from "zod";

export const SCENE_VERSION = 1;
export const MAX_ELEMENTS = 200;
export const MAX_STEPS = 100;
export const MAX_ACTIONS = 50;
export const DEFAULT_WIDTH = 800;
export const DEFAULT_HEIGHT = 450;
export const DEFAULT_DURATION_MS = 900;

const Id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/, "ids start with a letter and use letters, digits, - or _ (max 40)");
const Coord = z.number().finite().min(-5000).max(5000);
const Size = z.number().finite().min(8).max(2000);
const Label = z.string().max(400);
const Value = z.union([z.string().max(200), z.number().finite()]);

export const TONES = ["default", "accent", "good", "bad", "partial", "muted", "ai"] as const;
export const Tone = z.enum(TONES);
export type Tone = z.infer<typeof Tone>;

export const RELATIONS = ["plain", "supports", "attacks", "conflicts"] as const;
export const Relation = z.enum(RELATIONS);
export type Relation = z.infer<typeof Relation>;

const base = { id: Id, hidden: z.boolean().optional(), tone: Tone.optional() };
const placed = { ...base, x: Coord, y: Coord };

export const BoxElement = z.strictObject({
  ...placed,
  type: z.literal("box"),
  label: Label,
  w: Size.optional(),
  h: Size.optional(),
  shape: z.enum(["rect", "round", "ellipse"]).optional(),
  role: z.enum(["claim", "premise", "evidence", "conclusion", "note"]).optional(),
});

export const TextElement = z.strictObject({
  ...placed,
  type: z.literal("text"),
  text: Label,
  size: z.enum(["sm", "md", "lg"]).optional(),
  align: z.enum(["start", "middle", "end"]).optional(),
  w: Size.optional(),
});

export const ConnectorElement = z.strictObject({
  ...base,
  type: z.literal("connector"),
  from: Id,
  to: Id,
  relation: Relation.optional(),
  label: z.string().max(80).optional(),
  directed: z.boolean().optional(),
});

export const CodeElement = z.strictObject({
  ...placed,
  type: z.literal("code"),
  lines: z.array(z.string().max(300)).min(1).max(80),
  language: z.string().max(30).optional(),
  title: z.string().max(80).optional(),
  w: Size.optional(),
});

export const ArrayElement = z.strictObject({
  ...placed,
  type: z.literal("array"),
  values: z.array(Value).max(40),
  label: z.string().max(80).optional(),
  cellWidth: z.number().finite().min(20).max(200).optional(),
  pointers: z.array(z.strictObject({ name: z.string().min(1).max(12), index: z.number().int().min(0).nullable() })).max(8).optional(),
  showIndices: z.boolean().optional(),
});

export const PanelElement = z.strictObject({
  ...placed,
  type: z.literal("panel"),
  rows: z.array(z.strictObject({ key: z.string().min(1).max(40), value: Value })).max(30),
  label: z.string().max(80).optional(),
  w: Size.optional(),
});

export const StackElement = z.strictObject({
  ...placed,
  type: z.literal("stack"),
  frames: z.array(z.string().max(80)).max(20),
  label: z.string().max(80).optional(),
  w: Size.optional(),
});

export const GraphNode = z.strictObject({
  id: Id,
  label: z.string().max(80),
  x: Coord.optional(),
  y: Coord.optional(),
  hidden: z.boolean().optional(),
  tone: Tone.optional(),
});

export const GraphEdge = z.strictObject({
  id: Id.optional(),
  from: Id,
  to: Id,
  label: z.string().max(40).optional(),
  relation: Relation.optional(),
  directed: z.boolean().optional(),
  hidden: z.boolean().optional(),
});

export const GraphElement = z.strictObject({
  ...placed,
  type: z.literal("graph"),
  nodes: z.array(GraphNode).min(1).max(60),
  edges: z.array(GraphEdge).max(120),
  layout: z.enum(["tree", "layered", "circle", "row", "manual"]).optional(),
  root: Id.optional(),
  w: Size.optional(),
  h: Size.optional(),
});

export const Element = z.discriminatedUnion("type", [
  BoxElement,
  TextElement,
  ConnectorElement,
  CodeElement,
  ArrayElement,
  PanelElement,
  StackElement,
  GraphElement,
]);
export type Element = z.infer<typeof Element>;
export type ElementType = Element["type"];
export type GraphElement = z.infer<typeof GraphElement>;

const Part = z.union([z.string().min(1).max(40), z.number().int().min(0)]);
const target = { target: Id };

export const Action = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("highlight"), ...target, part: Part.optional(), tone: Tone.optional() }),
  z.strictObject({ op: z.literal("clear"), target: Id.optional(), part: Part.optional() }),
  z.strictObject({ op: z.literal("set"), ...target, part: Part.optional(), value: Value }),
  z.strictObject({ op: z.literal("swap"), ...target, i: z.number().int().min(0), j: z.number().int().min(0) }),
  z.strictObject({ op: z.literal("compare"), ...target, i: z.number().int().min(0), j: z.number().int().min(0) }),
  z.strictObject({ op: z.literal("pointer"), ...target, name: z.string().min(1).max(12), index: z.number().int().min(0).nullable() }),
  z.strictObject({ op: z.literal("push"), ...target, label: z.string().max(80) }),
  z.strictObject({ op: z.literal("pop"), ...target }),
  z.strictObject({ op: z.literal("show"), ...target, part: Part.optional() }),
  z.strictObject({ op: z.literal("hide"), ...target, part: Part.optional() }),
  z.strictObject({ op: z.literal("move"), ...target, x: Coord, y: Coord }),
  z.strictObject({
    op: z.literal("line"),
    ...target,
    line: z.number().int().min(1).nullable(),
    tokens: z.array(z.strictObject({ start: z.number().int().min(0), end: z.number().int().min(1) })).max(10).optional(),
  }),
]);
export type Action = z.infer<typeof Action>;

export const Step = z.strictObject({
  caption: z.string().trim().min(1).max(300),
  durationMs: z.number().int().min(0).max(10000).optional(),
  actions: z.array(Action).max(MAX_ACTIONS),
});
export type Step = z.infer<typeof Step>;

export const FAMILIES = ["code", "algorithm", "argument", "general"] as const;
export const ORIGINS = ["user-authored", "ai-suggested"] as const;

/** Structure and bounds only; `parseScene` adds the reference checks. */
export const SceneSchema = z.strictObject({
  version: z.literal(SCENE_VERSION, { error: "unsupported scene version (this engine reads version 1)" }),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1000),
  family: z.enum(FAMILIES),
  origin: z.enum(ORIGINS),
  width: z.number().int().min(200).max(2000).optional(),
  height: z.number().int().min(120).max(2000).optional(),
  elements: z.array(Element).min(1).max(MAX_ELEMENTS),
  steps: z.array(Step).max(MAX_STEPS),
});
export type Scene = z.infer<typeof SceneSchema>;

export type VizProblem = { path: string; message: string };
export type ParseResult = { ok: true; scene: Scene } | { ok: false; problems: VizProblem[] };

export function formatPath(path: ReadonlyArray<PropertyKey>): string {
  return path.length ? path.map(String).join(".") : "(root)";
}
