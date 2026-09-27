import { describe, expect, it } from "vitest";
import { feedbackContext } from "@/lib/feedbackContext";

const id = "0c9f3a52-4b7e-4c0e-9d4b-2f0a6c1ee41a";

describe("feedbackContext", () => {
  it("maps each route to a view and node", () => {
    expect(feedbackContext(`/n/${id}`)).toEqual({ view: "chat", nodeId: id });
    expect(feedbackContext("/")).toEqual({ view: "chat", nodeId: null });
    expect(feedbackContext("/map")).toEqual({ view: "map", nodeId: null });
    expect(feedbackContext("/definitions")).toEqual({ view: "definitions", nodeId: null });
    expect(feedbackContext("/somewhere/else")).toEqual({ view: "chat", nodeId: null });
    expect(feedbackContext("/n/not-a-uuid")).toEqual({ view: "chat", nodeId: null });
  });
});
