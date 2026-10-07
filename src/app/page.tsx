import { cookies } from "next/headers";
import { CanvasHost } from "@/canvas/CanvasHost";
import { AttachBanner, BackToDrill } from "@/drill/CanvasOverlays";
import { PROJECT_COOKIE, resolveProject } from "@/server/projects/projects";

export const dynamic = "force-dynamic";

type Params = { focus?: string | string[]; span?: string | string[]; returnTo?: string | string[]; attachTo?: string | string[] };
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);

/**
 * The open project's canvas (FR-023). `?focus=<id>&span=<start>-<end>` walks to an element and
 * selects text (R18, FR-055). From a drill (Feature 12): `returnTo` shows "Back to drill", and
 * `attachTo=<drillId>` is pick mode for attaching a conversation.
 */
export default async function Home({ searchParams }: { searchParams: Promise<Params> }) {
  const projectId = await resolveProject((await cookies()).get(PROJECT_COOKIE)?.value);
  const params = await searchParams;
  const returnTo = one(params.returnTo);
  const attachTo = one(params.attachTo);
  return (
    <>
      <CanvasHost key={projectId} projectId={projectId} focus={one(params.focus)} span={one(params.span)} />
      {attachTo ? <AttachBanner drillId={attachTo} returnTo={returnTo} /> : returnTo && <BackToDrill href={returnTo} />}
    </>
  );
}
