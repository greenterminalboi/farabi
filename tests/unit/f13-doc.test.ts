import { describe, expect, it } from "vitest";
import { activeTerms, allTerms } from "@/shared/lexicon";
import { lexiconDoc } from "@/shared/lexicon/doc";

describe("lexicon doc view (FR-021)", () => {
  it("lists every term once, grouped by slot, with the exact instruction sent", () => {
    const doc = lexiconDoc(allTerms());
    for (const t of activeTerms()) {
      expect(doc.split("\n").filter((l) => l === `### ${t.name}`), t.id).toHaveLength(1);
      expect(doc).toContain(`- Sent to the model: ${t.instruction}`);
    }
    expect(doc.indexOf("## Operation")).toBeLessThan(doc.indexOf("## Quality"));
  });

  it("marks retired terms", () => {
    const [first, ...rest] = allTerms();
    expect(lexiconDoc([{ ...first, retired: true }, ...rest])).toContain(`### ${first.name} (retired)`);
  });
});
