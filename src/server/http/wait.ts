import type { Element } from "@/shared/schemas";
import { waitFor } from "../answers/generation";

/** `?wait=1` answers only once the reply has ended (tests and scripts, Feature 2). */
export async function maybeWait<T extends { answer: Element }>(req: Request, result: T): Promise<T> {
  if (new URL(req.url).searchParams.get("wait") !== "1") return result;
  return { ...result, answer: await waitFor(result.answer.id) };
}
