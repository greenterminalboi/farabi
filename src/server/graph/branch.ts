// Branching from a span of any element's final text (FR-016, FR-017, FR-019). The branch is an
// unsent edge anchored to the span; the AI is never called here (Article IV).
import type { BranchResponse, Span, SpanRequest } from "@/shared/schemas";
import { db, type Trx } from "../db/client";
import { ConflictError, InvalidSelectionError } from "../errors";
import { assertId } from "../ids";
import { type ElementRow, insertElement, loadLive, toElement } from "./elements";

const CONTEXT_CHARS = 32;

/** An element whose text is final: a sent question edge, a complete answer, or a function output. */
function finalText(el: ElementRow): string | null {
  if (el.kind === "question") return el.text;
  if (el.kind === "answer") return el.status === "complete" ? el.text : null;
  if (el.origin === "run" && el.shape === "node") return el.text;
  return null;
}

/**
 * Checks that a span can anchor something on `elementId` (data-model.md "Branch, Define and
 * Park"). Outputs are leaves (R12): they anchor Define only, so Branch and Park pass
 * `allowOutput: false`. Returns the element and the span with its computed context.
 */
export async function validateSpan(
  trx: Trx,
  elementId: string,
  span: SpanRequest,
  options: { allowOutput: boolean } = { allowOutput: false },
): Promise<{ element: ElementRow; span: Span }> {
  const element = await loadLive(trx, elementId);
  const isOutput = element.origin === "run" && element.shape === "node";
  const text = finalText(element);
  if (text === null || (isOutput && !options.allowOutput)) {
    throw new ConflictError("not_branchable", "You can't branch from this text yet");
  }
  const { start, end } = span;
  if (!(start >= 0 && start < end && end <= text.length)) {
    throw new InvalidSelectionError("The selection is outside the text");
  }
  if (span.text.trim() === "") throw new InvalidSelectionError("The selection is empty");
  if (text.slice(start, end) !== span.text) {
    throw new InvalidSelectionError("The selected text doesn't match");
  }
  return {
    element,
    span: {
      start,
      end,
      text: span.text,
      prefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
      suffix: text.slice(end, end + CONTEXT_CHARS),
    },
  };
}

/** A question edge leaving `parent` at `span`: unsent, or sent at once with `text` (a fired tangent). */
export function insertBranchEdge(
  trx: Trx,
  parent: ElementRow,
  span: Span,
  origin: "branch" | "parked",
  text: string | null = null,
): Promise<ElementRow> {
  return insertElement(trx, {
    kind: "question",
    parentId: parent.id,
    treeId: parent.tree_id,
    projectId: parent.project_id,
    origin,
    provenance: "user_authored",
    anchor: span,
    text,
    sentAt: text === null ? null : new Date(),
  });
}

export async function createBranch(elementId: string, request: SpanRequest): Promise<BranchResponse> {
  assertId(elementId, "Element");
  return db.transaction().execute(async (trx) => {
    const { element, span } = await validateSpan(trx, elementId, request);
    const edge = await insertBranchEdge(trx, element, span, "branch");
    return { edge: toElement(edge) };
  });
}
