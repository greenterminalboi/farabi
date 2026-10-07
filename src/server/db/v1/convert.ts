// Rebuilds v1 conversations as v2 graph elements (contracts/migration.md). The only code, with
// verify.ts, that reads the frozen `v1` schema. Frozen once shipped: later migrations never change
// what it produces.
import { type Kysely, sql } from "kysely";

/** Rows converted per rule, printed by the migration and `npm run v1:convert` (FR-067). */
export type ConversionReport = Record<string, number>;

const V1_SOURCE_TABLES = [
  "trees",
  "nodes",
  "messages",
  "branch_markers",
  "edge_label_versions",
  "parked_tangents",
  "parked_tangent_events",
  "pipes",
  "function_output_versions",
  "function_output_events",
  "kind_setting_changes",
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function convertV1(db: Kysely<any>): Promise<ConversionReport> {
  let rows = 0;
  for (const table of V1_SOURCE_TABLES) {
    const { rows: counted } = await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.table(`v1.${table}`)}`.execute(db);
    rows += Number(counted[0].n);
  }
  if (rows > 0) throw new Error("v1 conversion is not implemented yet");
  return {};
}

export function printReport(report: ConversionReport): void {
  const entries = Object.entries(report);
  if (entries.length === 0) {
    console.log("v1 conversion: nothing to convert");
    return;
  }
  console.log("v1 conversion:");
  for (const [rule, n] of entries) console.log(`  ${rule}: ${n}`);
}
