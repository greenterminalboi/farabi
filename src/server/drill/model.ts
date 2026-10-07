// The model drill operations use (FR-027): the user's reply model from Feature 6, read through the
// settings resolver, never process.env (STATUS 12:15).
import { resolveReplyModel } from "../ai";
import { getSettings } from "../settings/settings";

export async function drillModel(): Promise<string | null> {
  return resolveReplyModel((await getSettings()).replyModel);
}
