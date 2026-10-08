import { regenerateFeedbackFile } from "@/server/feedback/exportFile";
import { withApi } from "@/server/http/withApi";

/** `npm run feedback:export` while the desktop app is open: rewrites FEEDBACK.md now. */
export const POST = withApi(async () => Response.json({ path: await regenerateFeedbackFile() }));
