// The state of function outputs, derived from their insert-only versions and review events (Feature
// 9, research R5, data-model.md "Derived state"). Nothing here calls the AI: staleness compares the
// version an output was made from with the input's current version (FR-022).
import type { Selectable } from "kysely";
import type { OutputSummary, Review } from "@/shared/schemas";
import { db } from "../db/client";
import type { FunctionOutputEventsTable, FunctionOutputVersionsTable, PipesTable, SourcePart } from "../db/schema";
import { READERS } from "./readers";

type Version = Selectable<FunctionOutputVersionsTable>;
type Event = Pick<Selectable<FunctionOutputEventsTable>, "kind" | "version_id">;

export type DerivedState = {
  review: Review;
  confirmedVersionId: string | null;
  latest: Version;
  displayed: Version;
  pendingDraft: boolean;
  stale: boolean;
};

/**
 * `versions` and `events` are newest first. A confirmed text stays displayed until the user
 * confirms a newer one (FR-026); staleness is judged on the newest attempt, so regenerating
 * clears it even while the draft waits.
 */
export function deriveOutputState(versions: Version[], events: Event[], currentVersion: string | undefined): DerivedState {
  const latest = versions[0];
  if (!latest) throw new Error("A function output always has at least one version");
  const review: Review = events[0]?.kind ?? "proposed";
  const confirmedVersionId = events.find((e) => e.kind === "confirmed")?.version_id ?? null;
  const confirmed = confirmedVersionId ? versions.find((v) => v.id === confirmedVersionId) : undefined;
  const displayed = review === "confirmed" && confirmed ? confirmed : latest;
  return {
    review,
    confirmedVersionId,
    latest,
    displayed,
    pendingDraft: review === "confirmed" && displayed.id !== latest.id,
    stale: latest.source_version !== currentVersion,
  };
}

export type OutputState = DerivedState & {
  pipe: Selectable<PipesTable>;
  /** Newest first. */
  versions: Version[];
};

/** Loads and derives the state of many outputs at once. Outputs without a pipe are skipped. */
export async function outputStates(outputIds: string[]): Promise<Map<string, OutputState>> {
  const result = new Map<string, OutputState>();
  if (outputIds.length === 0) return result;
  const [pipes, versions, events] = await Promise.all([
    db.selectFrom("pipes").selectAll().where("output_node_id", "in", outputIds).execute(),
    db
      .selectFrom("function_output_versions")
      .selectAll()
      .where("output_node_id", "in", outputIds)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .execute(),
    db
      .selectFrom("function_output_events")
      .select(["output_node_id", "kind", "version_id"])
      .where("output_node_id", "in", outputIds)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .execute(),
  ]);

  // The inputs' current versions, one bulk query per part that is read.
  const inputsByPart = new Map<SourcePart, string[]>();
  for (const p of pipes) inputsByPart.set(p.reads, [...(inputsByPart.get(p.reads) ?? []), p.input_node_id]);
  const current = new Map<SourcePart, Map<string, string>>();
  await Promise.all(
    [...inputsByPart].map(async ([part, ids]) => current.set(part, await READERS[part].currentVersions([...new Set(ids)]))),
  );

  const versionsBy = groupBy(versions, (v) => v.output_node_id);
  const eventsBy = groupBy(events, (e) => e.output_node_id);
  for (const pipe of pipes) {
    const own = versionsBy.get(pipe.output_node_id) ?? [];
    if (own.length === 0) continue;
    const derived = deriveOutputState(
      own,
      eventsBy.get(pipe.output_node_id) ?? [],
      current.get(pipe.reads)?.get(pipe.input_node_id),
    );
    result.set(pipe.output_node_id, { ...derived, pipe, versions: own });
  }
  return result;
}

/** Groups rows by key, keeping their order. */
function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

export function toOutputSummary(state: OutputState): OutputSummary {
  return {
    functionId: state.pipe.function_id,
    pipeId: state.pipe.node_id,
    inputNodeId: state.pipe.input_node_id,
    displayedText: state.displayed.text,
    provenance: state.review === "confirmed" ? "user_confirmed" : "ai_suggested",
    review: state.review,
    stale: state.stale,
    pendingDraft: state.pendingDraft,
    versionCount: state.versions.length,
  };
}
