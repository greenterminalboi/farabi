import type { Message } from "@/shared/schemas";

export class NotFoundError extends Error {
  readonly code = "not_found";
}

export class ConflictError extends Error {
  constructor(
    readonly code: string,
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

/** The AI service could not be reached. Carries anything already stored (e.g. the user message). */
export class AIServiceUnavailable extends Error {
  readonly code = "ai_unavailable";
  constructor(readonly stored: { userMessage?: Message } = {}) {
    super("The AI service is unavailable. Your message was saved; try again.");
  }
}

/** A node function's AI call failed; nothing was created or changed (Feature 9, FR-012). */
export class FunctionUnavailableError extends Error {
  readonly code = "ai_unavailable";
  constructor(detail?: string) {
    super(`The AI service is unavailable, so nothing was created. Try again.${detail ? ` (${detail})` : ""}`);
  }
}
