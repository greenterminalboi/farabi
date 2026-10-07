"use client";

// Element text on the drill screen, through v0.2's rich text pipeline (research R14): mapped spans
// inside a `data-node-id` item, so a selection maps onto the stored text for Branch, Define and Park.
import { useLayoutEffect, useRef } from "react";
import { renderBlocks } from "@/canvas/text/render";
import { richTextFor } from "@/canvas/text/richText";
import type { Element } from "@/shared/schemas";

export function ElementText({ element, markdown = true, className = "" }: { element: Element; markdown?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const text = element.text ?? "";
  useLayoutEffect(() => {
    if (ref.current) renderBlocks(ref.current, richTextFor(element.id, text, markdown).blocks, false);
  }, [element.id, text, markdown]);
  return (
    <div className={`element-text drill-text ${className}`} data-testid="element-text" data-node-id={element.id}>
      <div ref={ref} className="element-body" />
    </div>
  );
}

/** The AI tag on everything the AI made (Article I). */
export function AiTag({ title = "Made by the AI" }: { title?: string }) {
  return (
    <span className="ai-tag" title={title}>
      AI
    </span>
  );
}
