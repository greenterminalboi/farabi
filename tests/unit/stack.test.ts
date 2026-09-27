import { describe, expect, it } from "vitest";
import { stackLayers } from "@/map/forestGraph";

describe("stackLayers", () => {
  it("draws shallow nodes flat and deep ones as a stack", () => {
    expect(stackLayers(0)).toBe(0);
    expect(stackLayers(7)).toBe(0); // 3 exchanges
    expect(stackLayers(8)).toBe(1); // 4 exchanges
    expect(stackLayers(19)).toBe(1);
    expect(stackLayers(20)).toBe(2); // 10 exchanges
    expect(stackLayers(200)).toBe(2);
  });
});
