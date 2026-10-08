import type { z } from "zod";

/** A setting a kind declares (FR-053). Values are chosen from a bounded list. */
export type SettingDeclaration = {
  key: string;
  label: string;
  help: string;
  type: "choice";
  choices: Array<{ value: string; label: string }>;
  default: string;
};

/** Content (node) or act (edge) (FR-001, FR-043). */
export type Shape = "node" | "edge";

/** How the canvas draws a kind (contracts/canvas-ui.md). A new kind reuses one by declaration. */
export type Display = "answer" | "question" | "function_connector" | "output" | "drill";

/** The shape each display draws. */
export const DISPLAY_SHAPE: Record<Display, Shape> = {
  answer: "node",
  output: "node",
  question: "edge",
  function_connector: "edge",
  drill: "node",
};

/** An element kind (FR-043). Plain data, shared by the server and the client. */
export type NodeKindDeclaration = {
  id: string;
  label: string;
  /** Copied into nodes.shape on insert. */
  shape: Shape;
  display: Display;
  settings: SettingDeclaration[];
  /**
   * Checks a combination of this kind's resolved setting values (Feature 12, C6); returns a message
   * when it isn't allowed, e.g. "open before solid". Single values are checked by their choices.
   */
  validateSettings?: (values: Record<string, string>) => string | null;
  /** For function outputs: which kinds may be the input of the function that makes it. */
  acceptsInputKinds?: string[];
  /**
   * false: stored and shown on its own screen, never drawn on the canvas (Feature 12). Default true.
   * An element under a hidden parent is drawn from its nearest drawn ancestor (`drawnFrom`).
   */
  onCanvas?: boolean;
  /** The turn an element gives in a reply's ancestor-path context; absent means it is skipped. */
  contextRole?: "user" | "ai";
  /** Declared properties; strict, so undeclared keys are rejected (FR-054). */
  properties: z.ZodObject;
};
