import { z } from "zod";
import type { NodeKindDeclaration, SettingDeclaration } from "../types";

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ value: String(from + i), label: String(from + i) }));

const setting = (key: string, label: string, help: string, from: number, to: number, value: number): SettingDeclaration => ({
  key,
  label,
  help,
  type: "choice",
  choices: range(from, to),
  default: String(value),
});

/**
 * A drill on the canvas (FR-003): the one drill element drawn, as a card that opens the drill
 * screen. Its settings are explicit instructions about the drill's form (research R10, Article VI).
 */
export const drillKind: NodeKindDeclaration = {
  id: "drill",
  label: "Drill",
  shape: "node",
  display: "drill",
  settings: [
    setting("round_size", "Problems per round", "How many problems each round has", 1, 10, 4),
    setting("open_level", "Open the next rung at level", "When the newest rung opens the next one", 2, 9, 4),
    setting("solid_level", "Mark a rung solid at level", "When a rung counts as learned", 3, 10, 7),
  ],
  validateSettings: (v) =>
    Number(v.open_level) < Number(v.solid_level) ? null : "The opening level must be below the solid level",
  properties: z.object({}).strict(),
};
