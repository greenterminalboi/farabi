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
export type Display = "answer" | "question" | "function_connector" | "output";

/** The shape each display draws. */
export const DISPLAY_SHAPE: Record<Display, Shape> = {
  answer: "node",
  output: "node",
  question: "edge",
  function_connector: "edge",
};

/** An element kind (FR-043). Plain data, shared by the server and the client. */
export type NodeKindDeclaration = {
  id: string;
  label: string;
  /** Copied into nodes.shape on insert. */
  shape: Shape;
  display: Display;
  settings: SettingDeclaration[];
  /** For function outputs: which kinds may be the input of the function that makes it. */
  acceptsInputKinds?: string[];
  /** Declared properties; strict, so undeclared keys are rejected (FR-054). */
  properties: z.ZodObject;
};
