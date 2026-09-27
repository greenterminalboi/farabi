import { withApi } from "@/server/http/withApi";
import { enqueueStaleSummaries } from "@/server/summaries/queue";

/** Refreshes out-of-date labels in the background; called when the map is opened. */
export const POST = withApi(async () =>
  Response.json({ queued: await enqueueStaleSummaries() }, { status: 202 }),
);
