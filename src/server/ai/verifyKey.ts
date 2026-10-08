// Checks a Claude API key before it is saved (feature 11, PUT /api/host/api-key?verify=1): one
// 1-token request. Only a rejected key (401) fails; an outage doesn't block saving it.
import Anthropic from "@anthropic-ai/sdk";
import { defaultClaudeModel } from "./claude";

export async function verifyApiKey(apiKey: string): Promise<boolean> {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 15_000 });
  try {
    await client.messages.create({ model: defaultClaudeModel(), max_tokens: 1, messages: [{ role: "user", content: "ok" }] });
    return true;
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return false;
    console.error("Couldn't verify the API key; saving it anyway.", err instanceof Error ? err.message : err);
    return true;
  }
}
