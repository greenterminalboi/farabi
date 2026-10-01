import { expect, type Page } from "@playwright/test";
import pg from "pg";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://farabi:farabi@127.0.0.1:5432/farabi_test";

export async function resetDb(): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await client.query("TRUNCATE kind_setting_changes, function_output_events, function_output_versions, pipes, parked_tangent_events, parked_tangents, feedback_state_events, feedback_attachments, feedback_tags, feedback_items, setting_changes, node_summaries, branch_markers, messages, nodes, trees, projects RESTART IDENTITY CASCADE");
  await client.end();
}

export async function setAiMode(
  page: Page,
  mode: "ok" | "fail" | "slow" | "stall",
  delayMs?: number,
  chunkDelayMs?: number,
) {
  const res = await page.request.post("/api/test/ai-mode", { data: { mode, delayMs, chunkDelayMs } });
  expect(res.ok()).toBeTruthy();
}

export async function startConversation(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: /start a conversation|new conversation/i }).first().click();
  await page.waitForURL(/\/n\/[0-9a-f-]+$/);
  return page.url().split("/n/")[1];
}

export async function send(page: Page, text: string) {
  const before = await page.getByTestId("message").count();
  await page.getByLabel("Message").fill(text);
  await page.getByLabel("Message").press("Enter");
  await expect(page.getByTestId("message")).toHaveCount(before + 2);
  await waitForReplyEnd(page);
}

/** Waits until no reply is streaming in the open conversation. */
export async function waitForReplyEnd(page: Page) {
  await expect(page.locator(".typing", { hasText: "Thinking" })).toHaveCount(0);
  await expect(page.getByTestId("streaming")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
}

/** Selects `phrase` inside the last AI message by driving a DOM range, as a user drag would. */
export async function selectInLastAiMessage(page: Page, phrase: string) {
  await expect(page.locator('[data-role="ai"][data-message-id]').last()).toContainText(phrase);
  await page.evaluate((phrase) => {
    const messages = document.querySelectorAll<HTMLElement>('[data-role="ai"][data-message-id]');
    const msg = messages[messages.length - 1];
    // The phrase may span several text nodes (marker boundaries split text), so search the
    // concatenated text and map both ends back to their nodes.
    const walker = document.createTreeWalker(msg, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
    const full = nodes.map((n) => n.data).join("");
    const at = full.indexOf(phrase);
    if (at < 0) throw new Error(`phrase not found: ${phrase}`);
    const locate = (offset: number, isEnd: boolean) => {
      let seen = 0;
      for (const n of nodes) {
        const within = offset - seen;
        if (isEnd ? within <= n.data.length : within < n.data.length) return { node: n, offset: within };
        seen += n.data.length;
      }
      throw new Error("offset out of range");
    };
    const start = locate(at, false);
    const end = locate(at + phrase.length, true);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  }, phrase);
}

/**
 * Branch and Park ask for an optional question first (Feature 8); this confirms that step with
 * `question`, or blank.
 */
export async function confirmQuestion(page: Page, question = "") {
  const form = page.getByTestId("branch-question-form");
  if (question) await form.getByLabel("Your question (optional)").fill(question);
  await form.getByLabel("Your question (optional)").press("Enter");
}

export async function branchOn(page: Page, phrase: string, question = ""): Promise<string> {
  const parentUrl = page.url();
  await selectInLastAiMessage(page, phrase);
  await page.getByRole("toolbar", { name: "Highlight actions" }).getByRole("button", { name: "Branch" }).click();
  await confirmQuestion(page, question);
  await page.waitForURL((url) => url.toString() !== parentUrl && /\/n\//.test(url.pathname));
  return page.url().split("/n/")[1];
}

export type MapDebug = {
  nodes: Array<{
    id: string; treeId: string; x: number; y: number; isRoot: boolean; labelKind: string; label: string;
    kind: string; review: string | null; stale: boolean; pendingDraft: boolean;
  }>;
  edges: Array<{ from: string; to: string; label?: string | null }>;
  pipes: Array<{ id: string; from: string; to: string; state: string }>;
  treeBoxes: Record<string, { minX: number; minY: number; maxX: number; maxY: number }>;
};

export async function mapDebug(page: Page): Promise<MapDebug> {
  return page.evaluate(() => window.__farabiMapDebug as unknown as MapDebug);
}

export async function openMap(page: Page, expectedNodes: number) {
  await page.getByRole("link", { name: "Map" }).click();
  await page.waitForURL(/\/map$/);
  await expect
    .poll(async () => (await mapDebug(page))?.nodes.length ?? 0, { timeout: 10_000 })
    .toBe(expectedNodes);
}
