// Information pressure: how long and deep chat replies are (Feature 6, FR-002–FR-004).
export const PRESSURE_BANDS = ["Brief", "Concise", "Balanced", "Detailed", "Exhaustive"] as const;
export type PressureBand = (typeof PRESSURE_BANDS)[number];

export const MIN_PRESSURE = 1;
export const MAX_PRESSURE = 10;
export const DEFAULT_PRESSURE = 8;

/** The named band for a level: two levels per band, in increasing order (FR-003). */
export function bandOf(level: number): PressureBand {
  return PRESSURE_BANDS[Math.ceil(level / 2) - 1];
}
