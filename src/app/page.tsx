import { cookies } from "next/headers";
import { CanvasHost } from "@/canvas/CanvasHost";
import { PROJECT_COOKIE, resolveProject } from "@/server/projects/projects";

export const dynamic = "force-dynamic";

/** The open project's canvas (FR-023). `?focus=<id>` walks to an element (R18). */
export default async function Home({ searchParams }: { searchParams: Promise<{ focus?: string | string[] }> }) {
  const projectId = await resolveProject((await cookies()).get(PROJECT_COOKIE)?.value);
  const { focus } = await searchParams;
  return <CanvasHost key={projectId} projectId={projectId} focus={typeof focus === "string" ? focus : null} />;
}
