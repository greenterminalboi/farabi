import { findTerm, roleOf } from "./index";
import { SLOT_LABEL, SLOT_ORDER, type Term } from "./types";

const names = (ids: string[]) => (ids.length ? ids.map((id) => findTerm(id)?.name ?? id).join(", ") : "none");

/** The lexicon as markdown, grouped by slot (the Claude Doc view, FR-021). */
export function lexiconDoc(terms: Term[]): string {
  const out = [
    "# Farabi Lexicon",
    "",
    `Generated from the repo data (src/shared/lexicon/data). ${terms.filter((t) => !t.retired).length} active terms. Edit the data, not this document.`,
    "",
  ];
  for (const slot of SLOT_ORDER) {
    const inSlot = terms.filter((t) => t.slot === slot);
    if (!inSlot.length) continue;
    out.push(`## ${SLOT_LABEL[slot]}`, "");
    for (const t of inSlot) {
      out.push(`### ${t.name}${t.retired ? " (retired)" : ""}`, "");
      out.push(`- Id: \`${t.id}\` · v${t.version} · ${roleOf(t)}`);
      if (t.aliases.length) out.push(`- Also: ${t.aliases.join(", ")}`);
      out.push(`- Meaning: ${t.meaning}`, `- Example: ${t.example}`);
      out.push(`- Neighbours: ${names(t.neighbours)}`, `- Conflicts: ${names(t.conflicts)}`);
      out.push(`- Effect: ${t.effect}${t.check ? ` (checked by \`${t.check}\`)` : ""}`);
      out.push(`- Sent to the model: ${t.instruction}`, "");
    }
  }
  return out.join("\n");
}
