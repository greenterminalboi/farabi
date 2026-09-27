import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NewConversationButton } from "@/components/common/NewConversationButton";
import { db } from "@/server/db/client";
import { PROJECT_COOKIE, resolveProject } from "@/server/projects/projects";

export const dynamic = "force-dynamic";

export default async function Home() {
  const projectId = await resolveProject((await cookies()).get(PROJECT_COOKIE)?.value);
  const latest = await db
    .selectFrom("nodes")
    .innerJoin("trees", "trees.id", "nodes.tree_id")
    .select("nodes.id")
    .where("trees.project_id", "=", projectId)
    .orderBy("nodes.created_at", "desc")
    .limit(1)
    .executeTakeFirst();
  if (latest) redirect(`/n/${latest.id}`);
  return (
    <div className="empty-state">
      <h1>Start exploring</h1>
      <p>Begin a conversation. Highlight anything in it to branch off on a tangent.</p>
      <NewConversationButton label="Start a conversation" />
    </div>
  );
}
