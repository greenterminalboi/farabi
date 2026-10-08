// Templates (contracts/engine-api.md): valid scenes from simple input, for the three families. Used
// by the gallery, the fake generator and, later, integrations (a drill problem's code, a pair of
// conflicting statements on the canvas).
import type { Action, Element, Scene, Step } from "./schema";
import { MAX_STEPS } from "./schema";

type Origin = Scene["origin"];

// ---------------------------------------------------------------- code

export type TraceStep = {
  /** 1-based line being executed. */
  line: number;
  caption: string;
  /** Variables after this line; only changed or new ones animate. */
  vars?: Record<string, string | number>;
  /** The whole call stack after this line, bottom first. */
  stack?: string[];
  /** Column ranges on the line to mark. */
  tokens?: { start: number; end: number }[];
};

export function codeTrace(input: {
  title: string;
  description?: string;
  source: string;
  language?: string;
  trace: TraceStep[];
  origin?: Origin;
}): Scene {
  const lines = input.source.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n").slice(0, 80).map((l) => l.slice(0, 300));
  const longest = Math.max(...lines.map((l) => l.length));
  const codeW = Math.min(480, Math.max(260, longest * 7.8 + 50));
  const usesStack = input.trace.some((s) => s.stack?.length);
  const elements: Element[] = [
    { type: "code", id: "code", x: 24, y: 24, lines, language: input.language, title: input.language ? undefined : "Code", w: codeW },
    { type: "panel", id: "vars", x: 24 + codeW + 24, y: 24, label: "Variables", rows: [], w: Math.min(260, 800 - codeW - 72) },
  ];
  if (usesStack) elements.push({ type: "stack", id: "stack", x: 24 + codeW + 24, y: 230, label: "Call stack", frames: [], w: Math.min(260, 800 - codeW - 72) });
  const vars: Record<string, string | number> = {};
  let stack: string[] = [];
  const steps: Step[] = input.trace.slice(0, MAX_STEPS).map((s) => {
    const actions: Action[] = [];
    const line = Math.min(Math.max(1, s.line), lines.length);
    const lineText = lines[line - 1] ?? "";
    const tokens = (s.tokens ?? []).filter((t) => t.end > t.start && t.end <= lineText.length);
    actions.push({ op: "line", target: "code", line, ...(tokens.length ? { tokens } : {}) });
    for (const [k, v] of Object.entries(s.vars ?? {}).slice(0, 30)) {
      if (vars[k] !== v) actions.push({ op: "set", target: "vars", part: k, value: v });
      vars[k] = v;
    }
    if (s.stack && usesStack) {
      const next = s.stack.slice(0, 20);
      let common = 0;
      while (common < stack.length && common < next.length && stack[common] === next[common]) common++;
      for (let i = stack.length; i > common; i--) actions.push({ op: "pop", target: "stack" });
      for (const label of next.slice(common)) actions.push({ op: "push", target: "stack", label });
      stack = next;
    }
    return { caption: (s.caption.trim() || `Line ${line}`).slice(0, 300), actions: actions.slice(0, 50) };
  });
  return {
    version: 1,
    title: input.title,
    description: input.description ?? `Step-through of ${lines.length} lines of ${input.language ?? "code"}.`,
    family: "code",
    origin: input.origin ?? "user-authored",
    height: Math.max(450, Math.min(2000, 24 + lines.length * 20 + 80)),
    elements,
    steps,
  };
}

// ---------------------------------------------------------------- algorithms

export function arraySort(input: { title?: string; values: number[]; algorithm?: "bubble" | "insertion"; origin?: Origin }): Scene {
  const values = input.values.slice(0, 12);
  const a = [...values];
  const steps: Step[] = [];
  const algorithm = input.algorithm ?? "bubble";
  const push = (caption: string, actions: Action[]) => {
    if (steps.length < MAX_STEPS - 1) steps.push({ caption, actions });
  };
  if (algorithm === "bubble") {
    for (let end = a.length - 1; end > 0; end--) {
      let swapped = false;
      for (let i = 0; i < end; i++) {
        push(`Compare ${a[i]} and ${a[i + 1]}`, [
          { op: "pointer", target: "arr", name: "j", index: i },
          { op: "compare", target: "arr", i, j: i + 1 },
        ]);
        if (a[i] > a[i + 1]) {
          push(`${a[i]} > ${a[i + 1]}, so swap them`, [{ op: "swap", target: "arr", i, j: i + 1 }]);
          [a[i], a[i + 1]] = [a[i + 1], a[i]];
          swapped = true;
        }
      }
      push(`${a[end]} is in its final place`, [{ op: "highlight", target: "arr", part: end, tone: "good" }]);
      if (!swapped) break;
    }
  } else {
    for (let i = 1; i < a.length; i++) {
      push(`Take ${a[i]} and insert it into the sorted part`, [{ op: "pointer", target: "arr", name: "i", index: i }]);
      let j = i;
      while (j > 0) {
        push(`Compare ${a[j - 1]} and ${a[j]}`, [{ op: "compare", target: "arr", i: j - 1, j }]);
        if (a[j - 1] <= a[j]) break;
        push(`${a[j - 1]} > ${a[j]}, so swap them`, [{ op: "swap", target: "arr", i: j - 1, j }]);
        [a[j - 1], a[j]] = [a[j], a[j - 1]];
        j--;
      }
    }
  }
  const finish: Action[] = [{ op: "pointer", target: "arr", name: "j", index: null }, { op: "pointer", target: "arr", name: "i", index: null }];
  for (let i = 0; i < a.length; i++) finish.push({ op: "highlight", target: "arr", part: i, tone: "good" });
  steps.push({ caption: `Sorted: ${a.join(", ")}`, actions: finish });
  const name = algorithm === "bubble" ? "Bubble sort" : "Insertion sort";
  return {
    version: 1,
    title: input.title ?? `${name} of ${values.length} numbers`,
    description: `${name} of [${values.join(", ")}], one comparison at a time.`,
    family: "algorithm",
    origin: input.origin ?? "user-authored",
    height: 260,
    elements: [
      { type: "text", id: "heading", x: 40, y: 20, text: name, size: "lg" },
      { type: "array", id: "arr", x: 40, y: 70, label: "values", values, cellWidth: 56, pointers: [] },
    ],
    steps,
  };
}

// ---------------------------------------------------------------- arguments

export function contradiction(input: {
  title?: string;
  a: string;
  b: string;
  tension?: string;
  supportsA?: string[];
  supportsB?: string[];
  origin?: Origin;
}): Scene {
  const supportsA = (input.supportsA ?? []).slice(0, 3);
  const supportsB = (input.supportsB ?? []).slice(0, 3);
  const clip = (s: string) => (s.length > 300 ? `${s.slice(0, 299)}…` : s);
  const elements: Element[] = [
    { type: "box", id: "a", x: 40, y: 50, w: 260, label: clip(input.a), role: "claim", hidden: true },
    { type: "box", id: "b", x: 500, y: 50, w: 260, label: clip(input.b), role: "claim", hidden: true },
    { type: "connector", id: "tension", from: "a", to: "b", relation: "conflicts", label: input.tension?.slice(0, 80) ?? "contradiction", hidden: true },
  ];
  const evidence = (side: "a" | "b", items: string[], x: number) =>
    items.forEach((text, i) => {
      elements.push({ type: "box", id: `${side}s${i}`, x: x + (i - (items.length - 1) / 2) * 0, y: 230 + i * 70, w: 220, label: clip(text), role: "evidence", shape: "rect", hidden: true });
      elements.push({ type: "connector", id: `${side}c${i}`, from: `${side}s${i}`, to: side, relation: "supports", hidden: true });
    });
  evidence("a", supportsA, 60);
  evidence("b", supportsB, 520);
  const steps: Step[] = [
    { caption: "The first statement", actions: [{ op: "show", target: "a" }, { op: "highlight", target: "a" }] },
    { caption: "The second statement", actions: [{ op: "clear", target: "a" }, { op: "show", target: "b" }, { op: "highlight", target: "b" }] },
    {
      caption: input.tension ? `They pull against each other: ${input.tension}` : "They can't both hold as stated",
      actions: [{ op: "clear", target: "b" }, { op: "show", target: "tension" }, { op: "highlight", target: "tension", tone: "bad" }],
    },
  ];
  if (supportsA.length) steps.push({ caption: "What the first statement rests on", actions: supportsA.flatMap((_, i) => [{ op: "show", target: `as${i}` }, { op: "show", target: `ac${i}` }] as Action[]) });
  if (supportsB.length) steps.push({ caption: "What the second statement rests on", actions: supportsB.flatMap((_, i) => [{ op: "show", target: `bs${i}` }, { op: "show", target: `bc${i}` }] as Action[]) });
  steps.push({ caption: "Both statements, side by side, with the tension between them", actions: [{ op: "highlight", target: "a", tone: "partial" }, { op: "highlight", target: "b", tone: "partial" }] });
  const rows = Math.max(supportsA.length, supportsB.length);
  return {
    version: 1,
    title: input.title ?? "Two statements in tension",
    description: `Statement one: ${clip(input.a)} Statement two: ${clip(input.b)}`.slice(0, 1000),
    family: "argument",
    origin: input.origin ?? "user-authored",
    height: rows ? 250 + rows * 70 : 260,
    elements,
    steps,
  };
}

export function argumentMap(input: {
  title?: string;
  description?: string;
  claims: { id: string; text: string }[];
  relations: { from: string; to: string; relation: "supports" | "attacks" | "conflicts" }[];
  origin?: Origin;
}): Scene {
  const claims = input.claims.slice(0, 12);
  const ids = new Set(claims.map((c) => c.id));
  const relations = input.relations.filter((r) => ids.has(r.from) && ids.has(r.to) && r.from !== r.to).slice(0, 30);
  // Conclusions (nothing outgoing) on top; each statement one row below what it supports or attacks.
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const layerOf = (id: string): number => {
    if (layer.has(id)) return layer.get(id)!;
    visiting.add(id);
    let d = 0;
    for (const r of relations) if (r.from === id && r.relation !== "conflicts" && !visiting.has(r.to)) d = Math.max(d, layerOf(r.to) + 1);
    visiting.delete(id);
    layer.set(id, d);
    return d;
  };
  claims.forEach((c) => layerOf(c.id));
  const rows = new Map<number, string[]>();
  for (const c of claims) rows.set(layer.get(c.id)!, [...(rows.get(layer.get(c.id)!) ?? []), c.id]);
  const depth = Math.max(0, ...layer.values());
  const width = 800;
  const elements: Element[] = [];
  for (const c of claims) {
    const row = rows.get(layer.get(c.id)!)!;
    const k = row.indexOf(c.id);
    const w = Math.min(220, width / row.length - 20);
    elements.push({
      type: "box",
      id: c.id,
      x: ((k + 0.5) / row.length) * width - w / 2,
      y: 30 + layer.get(c.id)! * 140,
      w,
      label: c.text.slice(0, 300),
      role: layer.get(c.id) === 0 ? "claim" : "premise",
      hidden: true,
    });
  }
  relations.forEach((r, i) => elements.push({ type: "connector", id: `rel-${i}`, from: r.from, to: r.to, relation: r.relation, hidden: true }));
  const steps: Step[] = claims.map((c, ci) => {
    const actions: Action[] = [{ op: "show", target: c.id }];
    relations.forEach((r, i) => {
      const other = r.from === c.id ? r.to : r.to === c.id ? r.from : null;
      if (other && claims.findIndex((x) => x.id === other) < ci) actions.push({ op: "show", target: `rel-${i}` });
    });
    return { caption: c.text.length > 200 ? `${c.text.slice(0, 199)}…` : c.text, actions };
  });
  return {
    version: 1,
    title: input.title ?? "Argument map",
    description: input.description ?? `An argument of ${claims.length} statements and how they support or attack each other.`,
    family: "argument",
    origin: input.origin ?? "user-authored",
    height: Math.max(300, 30 + (depth + 1) * 140),
    elements,
    steps,
  };
}
