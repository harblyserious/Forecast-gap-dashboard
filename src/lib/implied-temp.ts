import type { MarketSnapshot } from "./database";

// Bucket-to-estimate logic (see CLAUDE.md "Matching Logic"):
// 'between' → range center; open tails → 3°F beyond the boundary.
// For 'less' markets the meaningful value is cap_strike (threshold is 0).
export function snapshotMidpoint(s: Pick<MarketSnapshot, "strike_type" | "threshold" | "cap_strike">): number {
  if (s.strike_type === "between") return (s.threshold + s.cap_strike!) / 2;
  if (s.strike_type === "greater") return s.threshold + 3;
  return s.cap_strike! - 3;
}

/** Probability-weighted average temperature across one event's bucket snapshots. */
export function impliedTempFromSnapshots(buckets: MarketSnapshot[]): number {
  const total = buckets.reduce((sum, b) => sum + b.yes_bid, 0);
  if (total === 0) return 0;
  return parseFloat(
    buckets.reduce((sum, b) => sum + (b.yes_bid / total) * snapshotMidpoint(b), 0).toFixed(2)
  );
}
