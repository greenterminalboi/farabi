// Frame states (feature 014, data-model.md): frame i is the scene's initial state with steps 1..i
// applied in order. The same fold validates references (parseScene) and feeds the renderer, so a
// scene that validates is a scene that renders.
import type { Action, Element, Scene, Tone } from "./schema";

export type CellMark = "compare" | "swap" | "changed" | null;
export type Cell = { key: string; value: string | number; tone: Tone | null; mark: CellMark };
export type Row = { key: string; value: string | number; tone: Tone | null; changed: boolean; visible: boolean };
export type Frame = { key: string; label: string; tone: Tone | null; changed: boolean };
export type NodeState = { visible: boolean; tone: Tone | null; label: string };
export type EdgeState = { visible: boolean; tone: Tone | null };

type Common = { id: string; visible: boolean; x: number; y: number; tone: Tone | null };

export type ElementState =
  | (Common & { type: "box"; label: string })
  | (Common & { type: "text"; text: string })
  | (Common & { type: "connector" })
  | (Common & { type: "code"; line: number | null; tokens: { start: number; end: number }[]; lineTones: Record<number, Tone> })
  | (Common & { type: "array"; cells: Cell[]; pointers: { name: string; index: number | null }[] })
  | (Common & { type: "panel"; rows: Row[] })
  | (Common & { type: "stack"; frames: Frame[]; nextKey: number })
  | (Common & { type: "graph"; nodes: Record<string, NodeState>; edges: Record<string, EdgeState> });

export type FrameState = { elements: Record<string, ElementState> };

/** A located problem found while applying a step (used by parseScene). */
export type StateProblem = { step: number; action: number; field?: string; message: string };

export const edgeId = (e: { id?: string; from: string; to: string }) => e.id ?? `${e.from}->${e.to}`;

function initialElement(el: Element): ElementState {
  const common = {
    id: el.id,
    visible: !el.hidden,
    x: "x" in el ? el.x : 0,
    y: "y" in el ? el.y : 0,
    tone: null,
  };
  switch (el.type) {
    case "box":
      return { ...common, type: "box", label: el.label };
    case "text":
      return { ...common, type: "text", text: el.text };
    case "connector":
      return { ...common, type: "connector" };
    case "code":
      return { ...common, type: "code", line: null, tokens: [], lineTones: {} };
    case "array":
      return {
        ...common,
        type: "array",
        cells: el.values.map((value, i) => ({ key: `c${i}`, value, tone: null, mark: null })),
        pointers: (el.pointers ?? []).map((p) => ({ ...p })),
      };
    case "panel":
      return { ...common, type: "panel", rows: el.rows.map((r) => ({ ...r, tone: null, changed: false, visible: true })) };
    case "stack":
      return {
        ...common,
        type: "stack",
        frames: el.frames.map((label, i) => ({ key: `f${i}`, label, tone: null, changed: false })),
        nextKey: el.frames.length,
      };
    case "graph":
      return {
        ...common,
        type: "graph",
        nodes: Object.fromEntries(el.nodes.map((n) => [n.id, { visible: !n.hidden, tone: null, label: n.label }])),
        edges: Object.fromEntries(el.edges.map((e) => [edgeId(e), { visible: !e.hidden, tone: null }])),
      };
  }
}

export function initialState(scene: Scene): FrameState {
  return { elements: Object.fromEntries(scene.elements.map((el) => [el.id, initialElement(el)])) };
}

function clone(state: FrameState): FrameState {
  return structuredClone(state);
}

/** Marks from compare, swap and set last only for the step that made them. */
function resetTransient(state: FrameState): void {
  for (const el of Object.values(state.elements)) {
    if (el.type === "array") for (const c of el.cells) c.mark = null;
    if (el.type === "panel") for (const r of el.rows) r.changed = false;
    if (el.type === "stack") for (const f of el.frames) f.changed = false;
  }
}

class ActionError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

/** A numeric part, accepting digit strings ("3") since generated scenes sometimes quote them. */
function indexPart(part: string | number | undefined, what: string): number {
  if (typeof part === "number") return part;
  if (typeof part === "string" && /^\d+$/.test(part)) return Number(part);
  throw new ActionError(`${what} needs a numeric part`, "part");
}

function clearTones(el: ElementState, part?: string | number): void {
  if (part === undefined) el.tone = null;
  switch (el.type) {
    case "code":
      if (part === undefined) el.lineTones = {};
      else delete el.lineTones[indexPart(part, "a code line")];
      break;
    case "array":
      el.cells.forEach((c, i) => {
        if (part === undefined || i === indexPart(part, "an array cell")) c.tone = null;
      });
      break;
    case "panel":
      for (const r of el.rows) if (part === undefined || r.key === String(part)) r.tone = null;
      break;
    case "stack":
      el.frames.forEach((f, i) => {
        if (part === undefined || i === indexPart(part, "a stack frame")) f.tone = null;
      });
      break;
    case "graph":
      for (const [id, n] of Object.entries(el.nodes)) if (part === undefined || id === String(part)) n.tone = null;
      for (const [id, e] of Object.entries(el.edges)) if (part === undefined || id === String(part)) e.tone = null;
      break;
  }
}

type PartRef =
  | { kind: "element" }
  | { kind: "line"; line: number }
  | { kind: "cell"; cell: Cell }
  | { kind: "row"; row: Row }
  | { kind: "frame"; frame: Frame }
  | { kind: "node"; node: NodeState }
  | { kind: "edge"; edge: EdgeState };

function resolvePart(el: ElementState, scene: Scene, part: string | number | undefined): PartRef {
  if (part === undefined) return { kind: "element" };
  switch (el.type) {
    case "code": {
      const line = indexPart(part, "a code line");
      const def = scene.elements.find((e) => e.id === el.id);
      const count = def?.type === "code" ? def.lines.length : 0;
      if (line < 1 || line > count) throw new ActionError(`"${el.id}" has no line ${line} (lines 1–${count})`, "part");
      return { kind: "line", line };
    }
    case "array": {
      const i = indexPart(part, "an array cell");
      if (i >= el.cells.length) throw new ActionError(`"${el.id}" has no cell ${i} (${el.cells.length} cells)`, "part");
      return { kind: "cell", cell: el.cells[i] };
    }
    case "panel": {
      const row = el.rows.find((r) => r.key === String(part));
      if (!row) throw new ActionError(`"${el.id}" has no row "${part}"`, "part");
      return { kind: "row", row };
    }
    case "stack": {
      const i = indexPart(part, "a stack frame");
      if (i >= el.frames.length) throw new ActionError(`"${el.id}" has no frame ${i} (${el.frames.length} frames)`, "part");
      return { kind: "frame", frame: el.frames[i] };
    }
    case "graph": {
      const id = String(part);
      if (el.nodes[id]) return { kind: "node", node: el.nodes[id] };
      if (el.edges[id]) return { kind: "edge", edge: el.edges[id] };
      throw new ActionError(`"${el.id}" has no node or edge "${id}"`, "part");
    }
    default:
      throw new ActionError(`a ${el.type} has no parts`, "part");
  }
}

function expectType<T extends ElementState["type"]>(el: ElementState, op: string, ...types: T[]): Extract<ElementState, { type: T }> {
  if (!(types as string[]).includes(el.type)) throw new ActionError(`"${op}" works on ${types.join(" or ")}, not on ${el.type} "${el.id}"`, "target");
  return el as Extract<ElementState, { type: T }>;
}

function arrayIndex(el: Extract<ElementState, { type: "array" }>, i: number, field: string): void {
  if (i >= el.cells.length) throw new ActionError(`"${el.id}" has no cell ${i} (${el.cells.length} cells)`, field);
}

export function applyAction(state: FrameState, scene: Scene, action: Action): void {
  if (action.op === "clear") {
    if (!action.target) {
      for (const el of Object.values(state.elements)) clearTones(el);
      return;
    }
    const el = state.elements[action.target];
    if (!el) throw new ActionError(`no element "${action.target}"`, "target");
    if (action.part !== undefined) resolvePart(el, scene, action.part);
    clearTones(el, action.part);
    return;
  }
  const el = state.elements[action.target];
  if (!el) throw new ActionError(`no element "${action.target}"`, "target");

  switch (action.op) {
    case "highlight": {
      const tone = action.tone ?? "accent";
      const ref = resolvePart(el, scene, action.part);
      if (ref.kind === "element") el.tone = tone;
      else if (ref.kind === "line" && el.type === "code") el.lineTones[ref.line] = tone;
      else if (ref.kind === "cell") ref.cell.tone = tone;
      else if (ref.kind === "row") ref.row.tone = tone;
      else if (ref.kind === "frame") ref.frame.tone = tone;
      else if (ref.kind === "node") ref.node.tone = tone;
      else if (ref.kind === "edge") ref.edge.tone = tone;
      return;
    }
    case "set": {
      if ((el.type === "array" || el.type === "stack" || el.type === "graph") && action.part === undefined)
        throw new ActionError(`"set" on a ${el.type} needs a part (which cell, frame or node)`, "part");
      if (el.type === "box" && action.part === undefined) el.label = String(action.value);
      else if (el.type === "text" && action.part === undefined) el.text = String(action.value);
      else if (el.type === "array") {
        const ref = resolvePart(el, scene, action.part);
        if (ref.kind === "cell") {
          ref.cell.value = action.value;
          ref.cell.mark = "changed";
        }
      } else if (el.type === "panel") {
        if (action.part === undefined) throw new ActionError(`"set" on a panel needs the row key as part`, "part");
        const key = String(action.part);
        const row = el.rows.find((r) => r.key === key);
        if (row) {
          row.value = action.value;
          row.changed = true;
          row.visible = true;
        } else {
          if (el.rows.length >= 30) throw new ActionError(`"${el.id}" already has 30 rows`, "part");
          el.rows.push({ key, value: action.value, tone: null, changed: true, visible: true });
        }
      } else if (el.type === "stack") {
        const ref = resolvePart(el, scene, action.part);
        if (ref.kind === "frame") {
          ref.frame.label = String(action.value);
          ref.frame.changed = true;
        }
      } else if (el.type === "graph") {
        const ref = resolvePart(el, scene, action.part);
        if (ref.kind !== "node") throw new ActionError(`"set" on a graph needs a node id as part`, "part");
        ref.node.label = String(action.value);
      } else throw new ActionError(`"set" can't change a ${el.type}${action.part !== undefined ? " part" : ""}`, "target");
      return;
    }
    case "swap":
    case "compare": {
      const arr = expectType(el, action.op, "array");
      arrayIndex(arr, action.i, "i");
      arrayIndex(arr, action.j, "j");
      if (action.op === "swap") {
        [arr.cells[action.i], arr.cells[action.j]] = [arr.cells[action.j], arr.cells[action.i]];
      }
      arr.cells[action.i].mark = action.op;
      arr.cells[action.j].mark = action.op;
      return;
    }
    case "pointer": {
      const arr = expectType(el, "pointer", "array");
      if (action.index !== null && action.index > arr.cells.length)
        throw new ActionError(`pointer "${action.name}" is past the end of "${arr.id}" (${arr.cells.length} cells)`, "index");
      const p = arr.pointers.find((x) => x.name === action.name);
      if (p) p.index = action.index;
      else {
        if (arr.pointers.length >= 8) throw new ActionError(`"${arr.id}" already has 8 pointers`, "name");
        arr.pointers.push({ name: action.name, index: action.index });
      }
      return;
    }
    case "push": {
      const st = expectType(el, "push", "stack");
      if (st.frames.length >= 20) throw new ActionError(`"${st.id}" already has 20 frames`, "target");
      st.frames.push({ key: `f${st.nextKey++}`, label: action.label, tone: null, changed: true });
      return;
    }
    case "pop": {
      const st = expectType(el, "pop", "stack");
      if (!st.frames.length) throw new ActionError(`"${st.id}" is empty; nothing to pop`, "target");
      st.frames.pop();
      return;
    }
    case "show":
    case "hide": {
      const visible = action.op === "show";
      const ref = resolvePart(el, scene, action.part);
      if (ref.kind === "element") el.visible = visible;
      else if (ref.kind === "row") ref.row.visible = visible;
      else if (ref.kind === "node") ref.node.visible = visible;
      else if (ref.kind === "edge") ref.edge.visible = visible;
      else throw new ActionError(`"${action.op}" can't change a single ${ref.kind}; hide the whole element or highlight it`, "part");
      return;
    }
    case "move": {
      if (el.type === "connector") throw new ActionError(`a connector follows its ends and can't be moved`, "target");
      el.x = action.x;
      el.y = action.y;
      return;
    }
    case "line": {
      const code = expectType(el, "line", "code");
      if (action.line !== null) resolvePart(code, scene, action.line);
      code.line = action.line;
      const def = scene.elements.find((e) => e.id === el.id);
      const text = def?.type === "code" && action.line !== null ? def.lines[action.line - 1] : "";
      const tokens = action.tokens ?? [];
      for (const [k, t] of tokens.entries()) {
        if (t.end <= t.start || t.end > text.length) throw new ActionError(`token ${k} (${t.start}–${t.end}) is outside line ${action.line} (length ${text.length})`, "tokens");
      }
      code.tokens = tokens.map((t) => ({ ...t }));
      return;
    }
  }
}

/** Folds all steps. Problems are collected (with the offending action skipped) when `problems` is given; otherwise the first one throws. */
export function computeStates(scene: Scene, problems?: StateProblem[]): FrameState[] {
  const states: FrameState[] = [initialState(scene)];
  scene.steps.forEach((step, s) => {
    const next = clone(states[states.length - 1]);
    resetTransient(next);
    step.actions.forEach((action, a) => {
      try {
        applyAction(next, scene, action);
      } catch (err) {
        if (!(err instanceof ActionError)) throw err;
        if (!problems) throw new Error(`steps.${s}.actions.${a}: ${err.message}`);
        problems.push({ step: s, action: a, field: err.field, message: err.message });
      }
    });
    states.push(next);
  });
  return states;
}

export const frameCount = (scene: Scene) => scene.steps.length + 1;

export function captionAt(scene: Scene, frame: number): string {
  const i = Math.max(0, Math.min(scene.steps.length, Math.floor(frame)));
  return i === 0 ? "Start" : scene.steps[i - 1].caption;
}

const toneWord = (t: Tone | null) => (t && t !== "default" ? ` [${t === "accent" ? "highlighted" : t}]` : "");

function summarizeElement(scene: Scene, el: ElementState, state: FrameState): string | null {
  if (!el.visible) return null;
  const def = scene.elements.find((e) => e.id === el.id)!;
  const name = (id: string) => {
    const other = state.elements[id];
    if (other?.type === "box") return `"${other.label}"`;
    if (other?.type === "text") return `"${other.text}"`;
    return id;
  };
  switch (el.type) {
    case "box": {
      const role = def.type === "box" && def.role ? `${def.role[0].toUpperCase()}${def.role.slice(1)}: ` : "";
      return `${role}${el.label}${toneWord(el.tone)}`;
    }
    case "text":
      return el.text ? `${el.text}${toneWord(el.tone)}` : null;
    case "connector": {
      if (def.type !== "connector") return null;
      if (!state.elements[def.from]?.visible || !state.elements[def.to]?.visible) return null;
      const rel = def.relation ?? "plain";
      const verb = rel === "supports" ? "supports" : rel === "attacks" ? "attacks" : rel === "conflicts" ? "conflicts with" : "leads to";
      return `${name(def.from)} ${verb} ${name(def.to)}${def.label ? ` (${def.label})` : ""}${toneWord(el.tone)}`;
    }
    case "code": {
      if (def.type !== "code") return null;
      const title = def.title ?? (def.language ? `${def.language} code` : "Code");
      if (el.line === null) return `${title}, ${def.lines.length} lines`;
      return `${title}, at line ${el.line}: ${def.lines[el.line - 1].trim()}`;
    }
    case "array": {
      const label = (def.type === "array" && def.label) || "Array";
      const values = el.cells.map((c) => String(c.value)).join(", ");
      const marked = (m: CellMark) => el.cells.flatMap((c, i) => (c.mark === m ? [i] : []));
      const parts = [`${label}: [${values}]`];
      const cmp = marked("compare");
      if (cmp.length) parts.push(`comparing positions ${cmp.join(" and ")}`);
      const sw = marked("swap");
      if (sw.length) parts.push(`swapped positions ${sw.join(" and ")}`);
      const hl = el.cells.flatMap((c, i) => (c.tone ? [`${i}${toneWord(c.tone)}`] : []));
      if (hl.length) parts.push(`marked ${hl.join(", ")}`);
      const ptrs = el.pointers.filter((p) => p.index !== null).map((p) => `${p.name}=${p.index}`);
      if (ptrs.length) parts.push(`pointers ${ptrs.join(", ")}`);
      return parts.join("; ");
    }
    case "panel": {
      const label = (def.type === "panel" && def.label) || "Variables";
      const rows = el.rows.filter((r) => r.visible).map((r) => `${r.key} = ${r.value}${r.changed ? " (changed)" : ""}${toneWord(r.tone)}`);
      return `${label}: ${rows.length ? rows.join(", ") : "empty"}`;
    }
    case "stack": {
      const label = (def.type === "stack" && def.label) || "Stack";
      return `${label} (top last): ${el.frames.length ? el.frames.map((f) => `${f.label}${toneWord(f.tone)}`).join(", ") : "empty"}`;
    }
    case "graph": {
      if (def.type !== "graph") return null;
      const nodes = def.nodes.filter((n) => el.nodes[n.id].visible).map((n) => `${el.nodes[n.id].label}${toneWord(el.nodes[n.id].tone)}`);
      const edges = def.edges
        .filter((e) => el.edges[edgeId(e)].visible && el.nodes[e.from]?.visible && el.nodes[e.to]?.visible)
        .map((e) => `${el.nodes[e.from].label}→${el.nodes[e.to].label}${toneWord(el.edges[edgeId(e)].tone)}`);
      return `Graph: nodes ${nodes.join(", ") || "none"}${edges.length ? `; edges ${edges.join(", ")}` : ""}`;
    }
  }
}

/** A plain-text summary of what frame `frame` shows (FR-009): caption, then each visible element. */
export function describeState(scene: Scene, state: FrameState, frame: number): string {
  const lines = scene.elements
    .map((def) => summarizeElement(scene, state.elements[def.id], state))
    .filter((x): x is string => Boolean(x));
  return [`${captionAt(scene, frame)}.`, ...(lines.length ? lines : ["Nothing is shown yet."])].join("\n");
}

export function describeFrame(scene: Scene, frame: number, states = computeStates(scene)): string {
  const i = Math.max(0, Math.min(scene.steps.length, Math.floor(frame)));
  return describeState(scene, states[i], i);
}

/** The scene's full text alternative: title, description and every step's caption. */
export function textAlternative(scene: Scene): string {
  const steps = scene.steps.map((s, i) => `Step ${i + 1}: ${s.caption}`);
  const origin = scene.origin === "ai-suggested" ? " (AI-suggested)" : "";
  return [`${scene.title}${origin}.`, scene.description, ...steps].join("\n");
}
