import { insertComparison, type MarketSnapshot, type Forecast, type InsertComparison } from "../../src/lib/database";
import { supabaseAdmin } from "../../src/lib/supabase";

// ─── Data fetching ────────────────────────────────────────────────────────────

async function getRecentSnapshots(): Promise<MarketSnapshot[]> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("market_snapshots")
    .select("*")
    .gte("fetched_at", twoHoursAgo)
    .order("fetched_at", { ascending: false });

  if (error) throw new Error(`Failed to query market_snapshots: ${error.message}`);
  return (data ?? []) as MarketSnapshot[];
}

async function getLatestForecast(city: string, date: string): Promise<Forecast | null> {
  const { data, error } = await supabaseAdmin
    .from("forecasts")
    .select("*")
    .eq("city", city)
    .eq("forecast_date", date)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to query forecasts for ${city}/${date}: ${error.message}`);
  return data as Forecast | null;
}

async function comparisonAlreadyExists(
  city: string,
  date: string,
  source: string,
  eventTicker: string
): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("comparisons")
    .select("id")
    .eq("city", city)
    .eq("comparison_date", date)
    .eq("source", source)
    .eq("series_ticker", eventTicker)
    .gte("fetched_at", oneHourAgo)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Duplicate check failed: ${error.message}`);
  return data !== null;
}

// ─── Implied temperature calculation ─────────────────────────────────────────

type StrikeType = "greater" | "less" | "between";

function midpoint(snapshot: MarketSnapshot): number {
  const { strike_type, threshold, cap_strike } = snapshot;
  if (strike_type === "between") {
    // cap_strike is guaranteed non-null for 'between' markets
    return (threshold + cap_strike!) / 2;
  }
  if (strike_type === "greater") {
    // Open upper tail: add 3°F beyond the lower bound
    return threshold + 3;
  }
  // 'less': open lower tail. threshold is 0 for these — use cap_strike.
  // See CLAUDE.md: market_snapshots field gotcha: "less" markets
  return cap_strike! - 3;
}

function computeImpliedTemp(buckets: MarketSnapshot[]): number {
  const totalBid = buckets.reduce((sum, b) => sum + b.yes_bid, 0);
  if (totalBid === 0) return 0;

  return buckets.reduce((sum, b) => {
    const normalizedProb = b.yes_bid / totalBid;
    return sum + normalizedProb * midpoint(b);
  }, 0);
}

// ─── Grouping helpers ─────────────────────────────────────────────────────────

// Groups snapshots by a composite key, deduplicating to the most recent
// snapshot per market_ticker so stale duplicates don't skew probabilities.
function dedupeByMarketTicker(snapshots: MarketSnapshot[]): MarketSnapshot[] {
  const seen = new Map<string, MarketSnapshot>();
  for (const s of snapshots) {
    const existing = seen.get(s.market_ticker);
    if (!existing || s.fetched_at > existing.fetched_at) {
      seen.set(s.market_ticker, s);
    }
  }
  return [...seen.values()];
}

// Groups deduplicated snapshots into per-event buckets.
// Key: "source|event_ticker|city|resolution_date"
function groupByEvent(snapshots: MarketSnapshot[]): Map<string, MarketSnapshot[]> {
  const groups = new Map<string, MarketSnapshot[]>();
  for (const s of snapshots) {
    const key = `${s.source}|${s.event_ticker}|${s.city}|${s.resolution_date}`;
    const group = groups.get(key) ?? [];
    group.push(s);
    groups.set(key, group);
  }
  return groups;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const fetchedAt = new Date().toISOString();
  console.log(`compute-comparisons started at ${fetchedAt}\n`);

  const allSnapshots = await getRecentSnapshots();
  if (allSnapshots.length === 0) {
    console.log("No market_snapshots found in the last 2 hours — nothing to compute.");
    return;
  }
  console.log(`Found ${allSnapshots.length} snapshots in the last 2 hours`);

  const deduplicated = dedupeByMarketTicker(allSnapshots);
  const eventGroups  = groupByEvent(deduplicated);
  console.log(`${deduplicated.length} unique markets across ${eventGroups.size} events\n`);

  let inserted = 0;
  let skipped  = 0;

  for (const [key, buckets] of eventGroups) {
    const rep = buckets[0]; // representative snapshot — all share these fields
    const { source, event_ticker, series_ticker, city, resolution_date } = rep;

    // Check for recent duplicate
    const exists = await comparisonAlreadyExists(city, resolution_date, source, event_ticker);
    if (exists) {
      console.log(`  skip ${source}/${event_ticker} — comparison inserted in last hour`);
      skipped++;
      continue;
    }

    // Get matching forecast
    const forecast = await getLatestForecast(city, resolution_date);
    if (!forecast) {
      console.warn(`  warn ${source}/${event_ticker} — no forecast found for ${city}/${resolution_date}`);
      skipped++;
      continue;
    }

    const implied_temp = parseFloat(computeImpliedTemp(buckets).toFixed(2));
    const nws_temp     = forecast.max_temp_24h;
    const gap          = parseFloat((implied_temp - nws_temp).toFixed(2));
    const gap_direction =
      gap >  1 ? "market_warmer" :
      gap < -1 ? "nws_warmer"   : "agree";

    const row: InsertComparison = {
      market_snapshot_id: rep.id,
      forecast_id:        forecast.id,
      city,
      comparison_date:    resolution_date,
      source:             source as "kalshi" | "polymarket",
      series_ticker:      event_ticker,   // store event_ticker for per-event granularity
      implied_temp,
      nws_temp,
      gap,
      gap_direction:      gap_direction as InsertComparison["gap_direction"],
      fetched_at:         fetchedAt,
    };

    await insertComparison(row);
    console.log(
      `  ✓ ${source}/${event_ticker} — implied: ${implied_temp}°F, nws: ${nws_temp}°F, gap: ${gap > 0 ? "+" : ""}${gap}°F (${gap_direction})`
    );
    inserted++;
  }

  console.log(`\nSummary: inserted=${inserted} skipped=${skipped}`);
}

run();
