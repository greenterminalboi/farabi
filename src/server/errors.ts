import type { Message } from "@/shared/schemas";

export class NotFoundError extends Error {
  readonly code = "not_found";
}

export class ConflictError extends Error {
  constructor(
    readonly code: string,
    message: string,
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
