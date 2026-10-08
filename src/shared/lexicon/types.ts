import { z } from "zod";

// The lexicon (Feature 13, specs/013-lexicon/contracts/registry.md): prompting terms the user
// attaches to a message as chips. Plain data, shared by the server and the client.

/** What a term fills in a message. The order is the order of the prompt block and of chips. */
export const SLOT_ORDER = ["operation", "scope", "format", "tone", "audience", "strength", "quality"] as const;
export const Slot = z.enum(SLOT_ORDER);
export type Slot = z.infer<typeof Slot>;

/** Slots that take at most one term per message; strength and quality take several. */
export const SINGLE_SLOTS: ReadonlySet<Slot> = new Set<Slot>(["operation", "scope", "format", "tone", "audience"]);

/** A soft limit from the research, enforced as a hard one (spec clarification). */
export const MAX_TERMS = 6;

export const SLOT_LABEL: Record<Slot, string> = {
  operation: "Operation",
  scope: "Scope",
  format: "Format",
  tone: "Tone",
  audience: "Audience",
  strength: "Strength",
  quality: "Quality",
};

const id = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "ids are lowercase words joined by hyphens");

/** One lexicon entry (data-model.md "Term"). */
export const Term = z
  .object({
    id,
    name: z.string().min(1),
    aliases: z.array(z.string().min(1)),
    slot: Slot,
    /** One line, from the dictionary's "what it asks for" column. */
    meaning: z.string().min(1),
    example: z.string().min(1),
    neighbours: z.array(id),
    /** Declared in both directions; a conflicting term can't be added beside this one. */
    conflicts: z.array(id),
    /** Increases whenever `instruction` changes (versions.lock.json enforces it). */
    version: z.number().int().min(1),
    /** The exact text sent to the model. */
    instruction: z
      .string()
      .min(1)
      .max(400)
      .refine((s) => !/[<>]/.test(s), "instructions contain no angle brackets"),
    /** The observable effect a reader or test can check. */
    effect: z.string().min(1),
    /** Id of a code check in checks.ts, where the effect can be checked by code. */
    check: z.string().optional(),
    /** Retired terms can't be added, but stay resolvable for the messages that used them. */
    retired: z.boolean().optional(),
  })
  .strict();
export type Term = z.infer<typeof Term>;

/** A term as recorded on a question edge or an answer: its id and the version used. */
export const TermUse = z.object({ id, v: z.number().int().min(1) }).strict();
export type TermUse = z.infer<typeof TermUse>;

/** The declared `lexicon` property of question edges and answers. */
export const LexiconUses = z
  .array(TermUse)
  .min(1)
  .max(MAX_TERMS)
  .refine((uses) => new Set(uses.map((u) => u.id)).size === uses.length, "a term is recorded once");
