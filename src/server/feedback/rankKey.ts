import { sql } from "kysely";

/**
 * Sort keys for the feedback list (research R3). A key is a decimal string with a 15-digit
 * zero-padded integer part and an optional fraction without trailing zeros, e.g.
 * `001790000000000` or `001790000000000.25`. For keys in that canonical form, byte-wise order
 * (COLLATE "C") equals numeric order, so Postgres and this module agree. The list shows keys in
 * descending order: higher key = higher on screen.
 */

const INT_DIGITS = 15;

/** Default key of an item nobody has dragged: its creation time in epoch milliseconds. */
export function createdAtKey(date: Date): string {
  return String(date.getTime()).padStart(INT_DIGITS, "0");
}

export function effectiveKey(item: { rank: string | null; created_at: Date }): string {
  return item.rank ?? createdAtKey(item.created_at);
}

/**
 * The same effective key, computed in SQL for ordering. `floor` matches JavaScript, whose Date
 * drops the microseconds Postgres stores (a plain ::bigint cast would round them).
 */
export const SQL_EFFECTIVE_KEY = sql<string>`COALESCE(feedback_items.rank, lpad(floor(extract(epoch FROM feedback_items.created_at) * 1000)::bigint::text, 15, '0'))`;

function parse(key: string): { scaled: bigint; digits: number } {
  const [int, frac = ""] = key.split(".");
  return { scaled: BigInt(int + frac), digits: frac.length };
}

function format(scaled: bigint, digits: number): string {
  const s = scaled.toString().padStart(INT_DIGITS + digits, "0");
  const int = s.slice(0, s.length - digits);
  const frac = s.slice(s.length - digits).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

function intPart(key: string): bigint {
  return BigInt(key.split(".")[0]);
}

/** Scales a key to exactly `digits` fraction digits. */
function scaleTo(key: string, digits: number): bigint {
  const p = parse(key);
  return p.scaled * 10n ** BigInt(digits - p.digits);
}

/**
 * A key strictly between `lo` (below) and `hi` (above). `lo = null` means the bottom of the list,
 * `hi = null` the top. Equal keys (two untouched items created in the same millisecond) give a key
 * just above both, the documented tie rule.
 */
export function keyBetween(lo: string | null, hi: string | null): string {
  if (lo === null && hi === null) throw new Error("keyBetween needs at least one neighbour");
  if (hi === null) return format(intPart(lo!) + 1n, 0);
  if (lo === null) {
    const below = intPart(hi) - 1n;
    if (below >= 0n) return format(below, 0);
    lo = "0".repeat(INT_DIGITS);
  }
  if (lo === hi) return lo.includes(".") ? `${lo}5` : `${lo}.5`;
  let digits = Math.max(parse(lo).digits, parse(hi).digits);
  for (;;) {
    const a = scaleTo(lo, digits);
    const b = scaleTo(hi, digits);
    if (a > b) throw new Error("keyBetween: lo is above hi");
    const mid = (a + b) / 2n;
    if (mid > a && mid < b) return format(mid, digits);
    digits += 1;
  }
}
