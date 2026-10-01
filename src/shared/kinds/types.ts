import type { z } from "zod";

/** A setting a kind declares (FR-029). Values are chosen from a bounded list. */
export type SettingDeclaration = {
  key: string;
  label: string;
  help: string;
  type: "choice";
  choices: Array<{ value: string; label: string }>;
  default: string;
};

/** The views a kind can open with (research R9). A new kind reuses one by declaration. */
export type ViewId = "chat" | "output_beside_input" | "pipe";

/** A node kind (FR-002). Plain data, shared by the server and the client. */
export type NodeKindDeclaration = {
  id: string;
  label: string;
  /** Backed by a conversation: has messages, and offers Branch, Define and Park (FR-005). */
  conversationBacked: boolean;
  view: ViewId;
  /** How its map label is produced (FR-006). */
  mapLabel: "summary" | "output_text" | "none";
  settings: SettingDeclaration[];
  /** For kinds produced by a function: which kinds may be its inputs. */
  acceptsInputKinds?: string[];
  /** Declared properties; strict, so undeclared keys are rejected (FR-035). */
  properties: z.ZodObject;
};
