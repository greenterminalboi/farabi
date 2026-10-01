import { z } from "zod";
import type { NodeKindDeclaration } from "./types";

export const analogyKind: NodeKindDeclaration = {
  id: "analogy",
  label: "Analogy",
  conversationBacked: false,
  view: "output_beside_input",
  mapLabel: "output_text",
  acceptsInputKinds: ["conversation"],
  // Explicit instructions about the form of the analogy (research R7, Article VI carve-out).
  settings: [
    {
      key: "reach",
      label: "How far afield",
      help: "Where the comparison is drawn from",
      type: "choice",
      choices: [
        { value: "close", label: "A neighbouring field" },
        { value: "everyday", label: "Everyday life" },
        { value: "far", label: "A distant, surprising domain" },
      ],
      default: "everyday",
    },
    {
      key: "length",
      label: "Length",
      help: "How long each analogy is",
      type: "choice",
      choices: [
        { value: "one_line", label: "One sentence" },
        { value: "short", label: "Two or three sentences" },
        { value: "paragraph", label: "A paragraph" },
      ],
      default: "short",
    },
  ],
  properties: z.object({}).strict(),
};
