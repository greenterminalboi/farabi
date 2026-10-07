import type { Element } from "@/shared/schemas";

export class NotFoundError extends Error {
  readonly code = "not_found";
}

/**
 * 409 codes (Feature 10, contracts/http-api.md): reply_in_progress, not_askable, not_branchable,
 * already_sent, not_retryable, not_regenerable, not_an_edge, origin_edge, wrong_kind, plus the
 * carried-over parked and project codes.
 */
export type ConflictCode =
  | "reply_in_progress"
  | "not_askable"
  | "not_branchable"
  | "already_sent"
  | "not_retryable"
  | "not_regenerable"
  | "not_an_edge"
  | "origin_edge"
  | "wrong_kind"
  | (string & {});

export class ConflictError extends Error {
  constructor(
    readonly code: ConflictCode,
    message: string,
    /** Extra fields for the error body, e.g. `{ kind }` for `wrong_kind` (Feature 9). */
    readonly extra?: object,
  ) {
    super(message);
  }
}

export class InvalidSelectionError extends Error {
  readonly code = "invalid_selection";
}

export class InvalidRequestError extends Error {
  readonly code = "invalid_request";
}

/** The AI service could not be reached. Carries anything already stored (e.g. the sent edge). */
export class AIServiceUnavailable extends Error {
  readonly code = "ai_unavailable";
  constructor(readonly stored: { edge?: Element } = {}) {
    super("The AI service is unavailable. Your message was saved; try again.");
  }
}

/** A function's AI call failed; nothing was created or changed (FR-052). */
export class FunctionUnavailableError extends Error {
  readonly code = "function_unavailable";
  constructor(detail?: string) {
    super(`The AI service is unavailable, so nothing was created. Try again.${detail ? ` (${detail})` : ""}`);
  }
}
