import { ChatView } from "@/components/chat/ChatView";

export default async function NodePage({ params }: { params: Promise<{ nodeId: string }> }) {
  const { nodeId } = await params;
  return <ChatView key={nodeId} nodeId={nodeId} />;
}
