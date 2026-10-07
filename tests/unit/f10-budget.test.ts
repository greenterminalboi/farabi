import { describe, expect, it } from "vitest";
import { allocate, type BudgetItem } from "@/canvas/text/budget";

const item = (id: string, screenArea: number, fullChars: number, pinned = false): BudgetItem => ({
  id,
  screenArea,
  fullChars,
  pinned,
});

describe("allocate", () => {
  it("shares the total in proportion to on-screen area", () => {
    const out = allocate([item("a", 300, 100_000), item("b", 100, 100_000)], 4000, 0);
    expect(out.get("a")! / out.get("b")!).toBeCloseTo(3, 1);
    expect(out.get("a")! + out.get("b")!).toBeLessThanOrEqual(4000);
  });

  it("gives every visible item at least the floor, or its whole text when shorter", () => {
    const out = allocate([item("big", 1e6, 50_000), item("tiny", 0.01, 5_000), item("short", 0.01, 10)], 1000, 24);
    expect(out.get("tiny")).toBeGreaterThanOrEqual(24);
    expect(out.get("short")).toBe(10);
  });

  it("never gives more than the full text and passes unused share on", () => {
    const out = allocate([item("small", 1000, 50), item("large", 1000, 10_000)], 2000, 0);
    expect(out.get("small")).toBe(50);
    expect(out.get("large")).toBeGreaterThan(1900);
  });

  it("gives pinned items their full text outside the total", () => {
    const out = allocate([item("pinned", 1, 9_000, true), item("other", 1000, 9_000)], 1000, 24);
    expect(out.get("pinned")).toBe(9_000);
    expect(out.get("other")).toBeLessThanOrEqual(1000);
  });

  it("caps the total across many items", () => {
    const items = Array.from({ length: 5000 }, (_, i) => item(`n${i}`, 10 + (i % 7), 1700));
    const out = allocate(items, 120_000, 24);
    const sum = [...out.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThanOrEqual(120_000);
    expect(Math.min(...out.values())).toBeGreaterThanOrEqual(24);
  });

  it("allocates 5,000 items in a couple of milliseconds", () => {
    const items = Array.from({ length: 5000 }, (_, i) => item(`n${i}`, 5 + (i % 50), 200 + (i % 8000)));
    // Best of several warm batches, so runner noise doesn't decide the result.
    let best = Infinity;
    for (let batch = 0; batch < 5; batch++) {
      const t = performance.now();
      for (let i = 0; i < 10; i++) allocate(items);
      best = Math.min(best, (performance.now() - t) / 10);
    }
    expect(best).toBeLessThan(2);
  });
});
