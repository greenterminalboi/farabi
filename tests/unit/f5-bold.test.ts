import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { describe, expect, it } from "vitest";
import { rehypeSourceOffsets } from "@/components/chat/rehypeSourceOffsets";

/** Renders Markdown as the chat does and returns each suggested span as [text, data-suggest]. */
function suggested(content: string, underlineBold = true): Array<[string, string]> {
  const html = renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { rehypePlugins: [[rehypeSourceOffsets, { markers: [], underlineBold }]] as any },
      content,
    ),
  );
  return [...html.matchAll(/<span[^>]*class="suggest-mark"[^>]*data-suggest="(\d+-\d+)"[^>]*>([^<]*)<\/span>/g)].map(
    (m) => [m[2], m[1]],
  );
}

describe("Feature 5 (reworked): bold text is underlined", () => {
  it("marks each bold span with its source offsets, and nothing else", () => {
    const content = "Pods run **containers** and use __shared volumes__ for storage.";
    const spans = suggested(content);
    expect(spans.map(([text]) => text)).toEqual(["containers", "shared volumes"]);
    for (const [text, range] of spans) {
      const [start, end] = range.split("-").map(Number);
      // The offsets select exactly the bold text in the stored reply, so Branch accepts it.
      expect(content.slice(start, end)).toBe(text);
    }
  });

  it("finds bold inside lists and headings, and splits around nested formatting", () => {
    const content = "# About **Pods**\n\n- **Scheduling** matters\n- **uses `kubectl` daily**";
    expect(suggested(content).map(([text]) => text)).toEqual(["Pods", "Scheduling", "uses ", " daily"]);
  });

  it("marks nothing when turned off, or when a reply has no bold", () => {
    expect(suggested("Pods run **containers**.", false)).toEqual([]);
    expect(suggested("Pods run *containers* in plain prose.")).toEqual([]);
  });
});
