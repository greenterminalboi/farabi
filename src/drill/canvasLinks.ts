// Going from the drill screen to the canvas (research R14): the canvas shows the open project, so
// the drill's project is opened first. `returnTo` puts a "Back to drill" button on the canvas.
import { api } from "@/lib/api";

export async function goToCanvas(projectId: string, params: Record<string, string>): Promise<void> {
  await api.openProject(projectId).catch(() => {});
  // A full load on purpose, as the project menu does: the canvas reads the newly opened project.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/?${new URLSearchParams(params).toString()}`);
}

export function drillHref(drillId: string, problemId?: string): string {
  return `/drill/${drillId}${problemId ? `#${problemId}` : ""}`;
}
