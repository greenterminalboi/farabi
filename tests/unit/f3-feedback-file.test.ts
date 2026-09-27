import { describe, expect, it } from "vitest";
import { renderFeedbackFile } from "@/server/feedback/exportFile";
import type { FeedbackItem } from "@/shared/schemas";

function item(over: Partial<FeedbackItem> & Pick<FeedbackItem, "id">): FeedbackItem {
  return {
    text: "Something",
    context: { view: "map", nodeId: null },
    tags: [],
    attachments: [],
    state: "open",
    history: [{ state: "open", provenance: "user_authored", at: "2026-09-27T10:00:00.000Z" }],
    manuallyPlaced: false,
    createdAt: "2026-09-27T10:00:00.000Z",
    ...over,
  };
}

const NOW = new Date("2026-09-27T12:00:00.000Z");

describe("renderFeedbackFile", () => {
  it("renders the header, the command and empty sections", () => {
    const text = renderFeedbackFile([], new Map(), NOW);
    expect(text).toContain("# Farabi feedback");
    expect(text).toContain("Generated 2026-09-27T12:00:00.000Z · 0 open · 0 addressed · 0 resolved");
    expect(text).toContain("npm run feedback:addressed -- <item id>");
    expect(text.match(/_None\._/g)).toHaveLength(3);
  });

  it("keeps open items in panel order and sorts the others by latest event", () => {
    const items = [
      item({ id: "open-b" }),
      item({ id: "open-a" }),
      item({
        id: "addr-old",
        state: "addressed",
        history: [
          { state: "open", provenance: "user_authored", at: "2026-09-27T09:00:00.000Z" },
          { state: "addressed", provenance: "ai_suggested", at: "2026-09-27T10:00:00.000Z" },
        ],
      }),
      item({
        id: "addr-new",
        state: "addressed",
        history: [
          { state: "open", provenance: "user_authored", at: "2026-09-27T09:00:00.000Z" },
          { state: "addressed", provenance: "ai_suggested", at: "2026-09-27T11:00:00.000Z" },
        ],
      }),
    ];
    const text = renderFeedbackFile(items, new Map(), NOW);
    const order = [...text.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
    expect(order).toEqual(["open-b", "open-a", "addr-new", "addr-old"]);
    expect(text.indexOf("## Open")).toBeLessThan(text.indexOf("open-b"));
    expect(text.indexOf("## Addressed")).toBeLessThan(text.indexOf("addr-new"));
    expect(text).toContain("2 open · 2 addressed · 0 resolved");
  });

  it("blockquotes text so Markdown in it cannot add headings", () => {
    const text = renderFeedbackFile([item({ id: "x", text: "# not a heading\n\nsecond line" })], new Map(), NOW);
    expect(text).toContain("> # not a heading\n>\n> second line");
    expect(text).not.toMatch(/^# not a heading/m);
  });

  it("lists context, tags, attachment paths and the full history", () => {
    const text = renderFeedbackFile(
      [
        item({
          id: "y",
          context: { view: "chat", nodeId: "node-1" },
          tags: [
            { text: "Map View", key: "map view" },
            { text: "layout", key: "layout" },
          ],
          attachments: [
            {
              id: "a1",
              url: "/api/feedback/attachments/a1",
              thumbUrl: "/api/feedback/attachments/a1?thumb=1",
              path: "feedback/attachments/y/a1.png",
              mimeType: "image/png",
              byteSize: 10,
              createdAt: "2026-09-27T10:00:00.000Z",
            },
          ],
          state: "open",
          history: [
            { state: "open", provenance: "user_authored", at: "2026-09-27T10:00:00.000Z" },
            { state: "resolved", provenance: "user_confirmed", at: "2026-09-27T10:05:00.000Z" },
            { state: "open", provenance: "user_authored", at: "2026-09-27T10:10:00.000Z" },
          ],
        }),
      ],
      new Map([["node-1", "Kubernetes scheduling"]]),
      NOW,
    );
    expect(text).toContain('view: chat · node: node-1 ("Kubernetes scheduling")');
    expect(text).toContain("- Tags: Map View, layout");
    expect(text).toContain("  - feedback/attachments/y/a1.png");
    expect(text).toContain("- State: open (since 2026-09-27T10:10:00.000Z)");
    expect(text.match(/^ {2}- 2026-09-27T10:\d\d:00\.000Z (open|resolved) \(/gm)).toHaveLength(3);
  });
});
