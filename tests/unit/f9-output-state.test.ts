import { describe, expect, it } from "vitest";
import { deriveOutputState } from "@/server/functions/state";

let t = 0;
const version = (id: string, source: string) => ({
  id,
  output_node_id: "o",
  text: `text ${id}`,
  source_version: source,
  function_version: 1,
  settings: {},
  provenance: "ai_suggested" as const,
  created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, t++)),
});
const confirmed = (id: string) => ({ kind: "confirmed" as const, version_id: id });
const rejected = { kind: "rejected" as const, version_id: null };

describe("Feature 9 · output state", () => {
  const v1 = version("v1", "s1");
  const v2 = version("v2", "s2");

  it("is proposed with no events and shows the latest", () => {
    const s = deriveOutputState([v2, v1], [], "s2");
    expect(s.review).toBe("proposed");
    expect(s.displayed.id).toBe("v2");
    expect(s.pendingDraft).toBe(false);
  });

  it("keeps a confirmed text until a newer one is confirmed (FR-026, SC-005)", () => {
    const s = deriveOutputState([v2, v1], [confirmed("v1")], "s2");
    expect(s.displayed.id).toBe("v1");
    expect(s.pendingDraft).toBe(true);
    const after = deriveOutputState([v2, v1], [confirmed("v2"), confirmed("v1")], "s2");
    expect(after.displayed.id).toBe("v2");
    expect(after.pendingDraft).toBe(false);
  });

  it("takes the newest event: rejected, then confirmed again", () => {
    expect(deriveOutputState([v1], [rejected, confirmed("v1")], "s1").review).toBe("rejected");
    expect(deriveOutputState([v1], [confirmed("v1"), rejected], "s1").review).toBe("confirmed");
  });

  it("is stale exactly when the latest version's source differs (FR-022)", () => {
    expect(deriveOutputState([v1], [], "s1").stale).toBe(false);
    expect(deriveOutputState([v1], [], "s9").stale).toBe(true);
    expect(deriveOutputState([v1], [], undefined).stale).toBe(true);
    // Judged on the newest attempt, even while a confirmed older text is displayed.
    expect(deriveOutputState([v2, v1], [confirmed("v1")], "s2").stale).toBe(false);
  });
});
