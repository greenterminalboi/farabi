/** A real 1×1 PNG. */
export const PNG_1PX = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);

/** Bytes that pass the WebP magic-byte check (RIFF....WEBP); enough for storage tests. */
export const WEBP_STUB = Uint8Array.from([
  ...Buffer.from("RIFF"),
  0x1a, 0, 0, 0,
  ...Buffer.from("WEBPVP8 "),
  ...new Array(18).fill(0),
]);

/** Different PNG bytes (the 1×1 PNG plus trailing data), so two attachments differ. */
export function pngVariant(n: number): Uint8Array {
  return Uint8Array.from([...PNG_1PX, ...Buffer.from(`variant-${n}`)]);
}

/** Every table a test may write, emptied before each test (v2, live, and the frozen v1 tables). */
export const TRUNCATE_TABLES = [
  "drill_offer_events",
  "drill_offers",
  "drill_attachments",
  "drill_verdict_overrides",
  "drill_problem_events",
  "drill_round_ends",
  "drill_level_changes",
  "drill_ladder_versions",
  "drills",
  "kind_setting_changes",
  "output_reviews",
  "edge_notes",
  "parked_tangent_events",
  "parked_tangents",
  "project_cameras",
  "v1_conversion",
  "v1_checksums",
  "feedback_state_events",
  "feedback_attachments",
  "feedback_tags",
  "feedback_items",
  "setting_changes",
  "definition_versions",
  "definitions",
  "nodes",
  "trees",
  "v1.kind_setting_changes",
  "v1.function_output_events",
  "v1.function_output_versions",
  "v1.pipes",
  "v1.parked_tangent_events",
  "v1.parked_tangents",
  "v1.edge_label_versions",
  "v1.node_summaries",
  "v1.branch_markers",
  "v1.messages",
  "v1.nodes",
  "v1.trees",
  "projects",
];

/** Rows to seed into the frozen v1 schema, by table (conversion tests, contracts/migration.md). */
export type V1Fixture = {
  [T in keyof import("@/server/db/v1/schema").V1Database as T extends `v1.${infer N}` ? N : never]?: Array<
    import("kysely").Insertable<import("@/server/db/v1/schema").V1Database[T]>
  >;
};

/** Inserts a v1 fixture in dependency order, in one transaction (trees reference their root). */
export async function seedV1(fixture: V1Fixture): Promise<void> {
  const { db } = await import("@/server/db/client");
  const { sql } = await import("kysely");
  const order = [
    "trees",
    "nodes",
    "messages",
    "branch_markers",
    "node_summaries",
    "edge_label_versions",
    "parked_tangents",
    "parked_tangent_events",
    "pipes",
    "function_output_versions",
    "function_output_events",
    "kind_setting_changes",
  ] as const;
  await db.transaction().execute(async (trx) => {
    // trees.root_node_id is deferrable; nodes reference trees.
    await sql`SET CONSTRAINTS ALL DEFERRED`.execute(trx);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- v1 tables aren't in the app's Database type
    const v1 = trx as any;
    for (const table of order) {
      const rows = fixture[table];
      if (rows?.length) await v1.insertInto(`v1.${table}`).values(rows).execute();
    }
  });
}
