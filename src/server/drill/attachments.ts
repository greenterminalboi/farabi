// Attached conversations (FR-031): any node in the drill's project, whose root-to-node path the AI
// reads when writing the ladder, lessons and problems. Attaching and detaching are append-only
// rows and never call the AI (FR-027).
import { db } from "../db/client";
import { ConflictError } from "../errors";
import { ancestorPath, turnOf } from "../graph/context";
import { loadLive } from "../graph/elements";
import { assertId } from "../ids";
import { loadAttachments } from "./load";
import type { AttachedText } from "./operations/ladder";
import { lockDrill } from "./state";

/** Attaches or detaches a node. A node in another project is refused; repeating the current action writes nothing. */
export async function setAttachment(drillId: string, nodeId: string, action: "attach" | "detach"): Promise<void> {
  assertId(nodeId, "Element");
  await db.transaction().execute(async (trx) => {
    const drill = await lockDrill(trx, drillId);
    const node = await loadLive(trx, nodeId);
    if (node.project_id !== drill.project_id) throw new ConflictError("wrong_project", "Only a conversation in this project can be attached");
    const latest = await trx
      .selectFrom("drill_attachments")
      .select("action")
      .where("drill_id", "=", drill.id)
      .where("node_id", "=", nodeId)
      .orderBy("seq", "desc")
      .limit(1)
      .executeTakeFirst();
    if ((latest?.action ?? "detach") === action) return;
    await trx.insertInto("drill_attachments").values({ drill_id: drill.id, node_id: nodeId, action }).execute();
  });
}

/** Characters of each attached conversation given to the AI (its most recent part). */
export const ATTACHMENT_CHARS = 6000;

/** The attached conversations as the AI reads them: each path's turns, labelled, oldest first. */
export async function attachedTexts(drillId: string): Promise<AttachedText[]> {
  const attached = await loadAttachments(db, drillId);
  return Promise.all(
    attached.map(async (a) => {
      const path = await ancestorPath(a.nodeId);
      const text = path
        .map((el) => turnOf(el))
        .filter((t) => t !== null)
        .map((t) => `${t.role === "user" ? "User" : "AI"}: ${t.content}`)
        .join("\n\n");
      return { nodeId: a.nodeId, text: text.slice(-ATTACHMENT_CHARS) };
    }),
  );
}
