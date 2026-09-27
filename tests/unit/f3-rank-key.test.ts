import { describe, expect, it } from "vitest";
import { createdAtKey, keyBetween } from "@/server/feedback/rankKey";

// Byte-wise, as Postgres COLLATE "C" compares.
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

describe("createdAtKey", () => {
  it("sorts the same way as the dates", () => {
    const dates = [new Date("2026-01-01"), new Date("2026-09-27T10:00:00Z"), new Date("2030-05-05")];
    const keys = dates.map(createdAtKey);
    expect(keys.every((k) => k.length === 15)).toBe(true);
    expect([...keys].sort(cmp)).toEqual(keys);
  });
});

describe("keyBetween", () => {
  const lo = createdAtKey(new Date("2026-09-27T10:00:00.000Z"));
  const hi = createdAtKey(new Date("2026-09-27T10:00:00.001Z")); // 1 ms apart: the tightest gap

  it("returns a key strictly between its neighbours", () => {
    const k = keyBetween(lo, hi);
    expect(cmp(lo, k)).toBe(-1);
    expect(cmp(k, hi)).toBe(-1);
  });

  it("uses whole numbers when there is room", () => {
    expect(keyBetween("000000000000010", "000000000000020")).toBe("000000000000015");
  });

  it("never runs out of room: 200 insertions into the same gap stay strictly ordered", () => {
    let top = hi;
    const bottom = lo;
    for (let i = 0; i < 200; i++) {
      const k = keyBetween(bottom, top);
      expect(cmp(bottom, k)).toBe(-1);
      expect(cmp(k, top)).toBe(-1);
      top = k; // keep dropping just above the bottom item
    }
    let low = lo;
    for (let i = 0; i < 200; i++) {
      const k = keyBetween(low, hi);
      expect(cmp(low, k)).toBe(-1);
      expect(cmp(k, hi)).toBe(-1);
      low = k; // keep dropping just below the top item
    }
  });

  it("handles the ends of the list", () => {
    expect(cmp(keyBetween(hi, null), hi)).toBe(1);
    expect(cmp(keyBetween(null, lo), lo)).toBe(-1);
    expect(cmp(keyBetween(null, "000000000000000.5"), "000000000000000.5")).toBe(-1);
  });

  it("places an item just above two equal keys (tie rule)", () => {
    const k = keyBetween(lo, lo);
    expect(cmp(k, lo)).toBe(1);
    expect(cmp(k, hi)).toBe(-1);
  });

  it("never produces trailing zeros, so byte order equals numeric order", () => {
    const k = keyBetween("000000000000001.2", "000000000000001.3");
    expect(k).toBe("000000000000001.25");
    expect(k.endsWith("0")).toBe(false);
  });

  it("rejects neighbours in the wrong order", () => {
    expect(() => keyBetween(hi, lo)).toThrow();
  });
});
