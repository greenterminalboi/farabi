import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { KindSettingsFields } from "@/components/settings/KindSettingsSections";
import { registerKind } from "@/shared/kinds";

describe("Feature 9 · settings sections come from declarations (SC-007)", () => {
  it("renders a section for a kind added by declaration alone", () => {
    registerKind({
      id: "test-counterexample",
      label: "Counter-example",
      conversationBacked: false,
      view: "output_beside_input",
      mapLabel: "output_text",
      acceptsInputKinds: ["conversation"],
      properties: z.object({}).strict(),
      settings: [
        {
          key: "strength",
          label: "Strength",
          help: "How hard it pushes back",
          type: "choice",
          choices: [
            { value: "gentle", label: "Gentle" },
            { value: "hard", label: "Hard" },
          ],
          default: "gentle",
        },
      ],
    });
    const html = renderToStaticMarkup(
      createElement(KindSettingsFields, {
        data: {
          kinds: [
            { kind: "analogy", settings: [] },
            { kind: "test-counterexample", settings: [{ key: "strength", value: "hard", source: "kind", kindValue: "hard", changedAt: null }] },
            { kind: "conversation", settings: [] },
          ],
        },
        onChange: () => undefined,
      }),
    );
    expect(html).toContain('data-testid="kind-settings-test-counterexample"');
    expect(html).toContain('data-testid="kind-setting-test-counterexample-strength"');
    expect(html).toContain("Gentle (default)");
    expect(html).toContain('data-testid="kind-settings-analogy"');
    expect(html).not.toContain("kind-settings-conversation");
  });
});
