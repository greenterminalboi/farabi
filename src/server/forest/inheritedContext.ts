import { sql } from "kysely";
import type { InheritedContextEntry } from "@/shared/schemas";
import { db } from "../db/client";
import type { MessagesTable } from "../db/schema";
import { toMessage } from "../mappers";
import type { Selectable } from "kysely";

type Row = Selectable<MessagesTable> & { depth: number };

/**
 * The parent conversation a branch inherits (FR-005, FR-033): for every ancestor, its live,
 * complete messages up to and including the message that holds the next branch point down the
 * chain. Oldest ancestor first. Empty for roots.
 */
export async function getInheritedContext(nodeId: string): Promise<InheritedContextEntry[]> {
  const { rows } = await sql<Row>`
    WITH RECURSIVE chain AS (
      SELECT id AS node_id, parent_id, 0 AS depth FROM nodes WHERE id = ${nodeId}
      UNION ALL
      SELECT p.id, p.parent_id, c.depth + 1
      FROM nodes p JOIN chain c ON p.id = c.parent_id
    ),
    cuts AS (
      SELECT anc.node_id, anc.depth, cut.seq AS cut_seq
      FROM chain anc
      JOIN chain child ON child.depth = anc.depth - 1
      JOIN branch_markers bm ON bm.child_node_id = child.node_id
      JOIN messages cut ON cut.id = bm.message_id
      WHERE anc.depth >= 1
    )
    SELECT m.*, cuts.depth
    FROM cuts
    JOIN messages m ON m.node_id = cuts.node_id
    WHERE m.seq <= cuts.cut_seq AND m.replaced_at IS NULL AND m.status = 'complete'
    ORDER BY cuts.depth DESC, m.seq ASC
  `.execute(db);

  const entries: InheritedContextEntry[] = [];
  for (const row of rows) {
    const last = entries.at(-1);
    const message = toMessage(row);
    if (last && last.nodeId === row.node_id) last.messages.push(message);
    else entries.push({ nodeId: row.node_id, messages: [message] });
  }
  return entries;
}
