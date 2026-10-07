import { describe, expect, it } from "vitest";
import { feedbackContext } from "@/lib/feedbackContext";

const project = "0c9f3a52-4b7e-4c0e-9d4b-2f0a6c1ee41a";
const element = "1d0f3a52-4b7e-4c0e-9d4b-2f0a6c1ee41b";

describe("feedbackContext (Feature 10, FR-058)", () => {
  it("records the open project and, on the canvas, the focused element", () => {
    const canvas = { projectId: project, focusId: element };
    expect(feedbackContext("/", canvas)).toEqual({ view: "canvas", projectId: project, elementId: element });
    expect(feedbackContext("/", { projectId: project, focusId: null })).toEqual({ view: "canvas", projectId: project, elementId: null });
    expect(feedbackContext("/definitions", canvas)).toEqual({ view: "definitions", projectId: project, elementId: null });
    expect(feedbackContext("/settings", canvas)).toEqual({ view: "canvas", projectId: project, elementId: null });
    expect(feedbackContext("/", { projectId: null, focusId: null })).toEqual({ view: "canvas", projectId: null, elementId: null });
  });
});
