import { redirect } from "next/navigation";
import { NewConversationButton } from "@/components/common/NewConversationButton";
import { db } from "@/server/db/client";

export const dynamic = "force-dynamic";

export default async function Home() {
  const latest = await db
    .selectFrom("nodes")
    .select("id")
    .orderBy("created_at", "desc")
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
