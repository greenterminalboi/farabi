// parseScene (FR-002, the scene contract § Validation): structure and bounds from the zod schema,
// then references (unique ids, connector and graph endpoints, the 200-element limit counting graph
// nodes), then a simulation of every step so each target and part exists when it is used.
import { formatPath, MAX_ELEMENTS, type ParseResult, type Scene, SceneSchema, type VizProblem } from "./schema";
import { computeStates, edgeId, type StateProblem } from "./state";

function referenceProblems(scene: Scene): VizProblem[] {
  const problems: VizProblem[] = [];
  const ids = new Map<string, number>();
  let count = 0;
  scene.elements.forEach((el, i) => {
    if (ids.has(el.id)) problems.push({ path: `elements.${i}.id`, message: `duplicate id "${el.id}" (also elements.${ids.get(el.id)})` });
    else ids.set(el.id, i);
    count += el.type === "graph" ? el.nodes.length : 1;
  });
  if (count > MAX_ELEMENTS) problems.push({ path: "elements", message: `too many elements: ${count} (graph nodes count; max ${MAX_ELEMENTS})` });

  scene.elements.forEach((el, i) => {
    if (el.type === "connector") {
      for (const end of ["from", "to"] as const) {
        const target = scene.elements.find((e) => e.id === el[end]);
        if (!target) problems.push({ path: `elements.${i}.${end}`, message: `no element "${el[end]}"` });
        else if (target.type === "connector") problems.push({ path: `elements.${i}.${end}`, message: `a connector can't end at another connector ("${el[end]}")` });
      }
      if (el.from === el.to) problems.push({ path: `elements.${i}.to`, message: "a connector needs two different ends" });
    }
    if (el.type === "graph") {
      const nodeIds = new Set<string>();
      el.nodes.forEach((n, k) => {
        if (nodeIds.has(n.id)) problems.push({ path: `elements.${i}.nodes.${k}.id`, message: `duplicate node id "${n.id}"` });
        nodeIds.add(n.id);
      });
      const edgeIds = new Set<string>();
      el.edges.forEach((e, k) => {
        for (const end of ["from", "to"] as const)
          if (!nodeIds.has(e[end])) problems.push({ path: `elements.${i}.edges.${k}.${end}`, message: `no node "${e[end]}" in graph "${el.id}"` });
        const id = edgeId(e);
        if (edgeIds.has(id) || nodeIds.has(id)) problems.push({ path: `elements.${i}.edges.${k}`, message: `duplicate edge id "${id}"; give the edge an id` });
        edgeIds.add(id);
      });
      if (el.root && !nodeIds.has(el.root)) problems.push({ path: `elements.${i}.root`, message: `no node "${el.root}" in graph "${el.id}"` });
    }
    if (el.type === "array") {
      (el.pointers ?? []).forEach((p, k) => {
        if (p.index !== null && p.index > el.values.length)
          problems.push({ path: `elements.${i}.pointers.${k}.index`, message: `pointer "${p.name}" is past the end (${el.values.length} cells)` });
      });
    }
  });
  return problems;
}

const statePath = (p: StateProblem) => `steps.${p.step}.actions.${p.action}${p.field ? `.${p.field}` : ""}`;

/** Validates anything (parsed JSON) as a version 1 scene; never throws. */
export function parseScene(input: unknown): ParseResult {
  const parsed = SceneSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.slice(0, 30).map((i) => ({ path: formatPath(i.path), message: i.message })) };
  }
  const scene = parsed.data;
  const problems = referenceProblems(scene);
  if (problems.length) return { ok: false, problems };
  const stateProblems: StateProblem[] = [];
  computeStates(scene, stateProblems);
  if (stateProblems.length) return { ok: false, problems: stateProblems.slice(0, 30).map((p) => ({ path: statePath(p), message: p.message })) };
  return { ok: true, scene };
}

/** parseScene for trusted input (examples, templates): throws with every problem listed. */
export function sceneOrThrow(input: unknown): Scene {
  const result = parseScene(input);
  if (!result.ok) throw new Error(`Invalid scene: ${result.problems.map((p) => `${p.path}: ${p.message}`).join("; ")}`);
  return result.scene;
}
