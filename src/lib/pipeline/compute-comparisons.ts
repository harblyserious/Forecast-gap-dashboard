import { insertComparison, type MarketSnapshot, type Forecast, type InsertComparison } from "../database";
import { supabaseAdmin } from "../supabase";

export interface ComputeComparisonsResult {
  inserted: number;
  skipped:  number;
}

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

function midpoint(snapshot: MarketSnapshot): number {
  const { strike_type, threshold, cap_strike } = snapshot;
  if (strike_type === "between") return (threshold + cap_strike!) / 2;
  if (strike_type === "greater") return threshold + 3;
  // 'less': threshold is 0 — use cap_strike (see CLAUDE.md gotcha)
  return cap_strike! - 3;
}

function computeImpliedTemp(buckets: MarketSnapshot[]): number {
  const totalBid = buckets.reduce((sum, b) => sum + b.yes_bid, 0);
  if (totalBid === 0) return 0;
  return buckets.reduce((sum, b) => sum + (b.yes_bid / totalBid) * midpoint(b), 0);
}

function dedupeByMarketTicker(snapshots: MarketSnapshot[]): MarketSnapshot[] {
  const seen = new Map<string, MarketSnapshot>();
  for (const s of snapshots) {
    const existing = seen.get(s.market_ticker);
    if (!existing || s.fetched_at > existing.fetched_at) seen.set(s.market_ticker, s);
  }
  return [...seen.values()];
}

function groupByEvent(snapshots: MarketSnapshot[]): Map<string, MarketSnapshot[]> {
  const groups = new Map<string, MarketSnapshot[]>();
  for (const s of snapshots) {
    const key   = `${s.source}|${s.event_ticker}|${s.city}|${s.resolution_date}`;
    const group = groups.get(key) ?? [];
    group.push(s);
    groups.set(key, group);
  }
  return groups;
}

export async function runComputeComparisons(): Promise<ComputeComparisonsResult> {
  const fetchedAt = new Date().toISOString();
  const result: ComputeComparisonsResult = { inserted: 0, skipped: 0 };

  const allSnapshots  = await getRecentSnapshots();
  if (allSnapshots.length === 0) return result;

  const deduplicated  = dedupeByMarketTicker(allSnapshots);
  const eventGroups   = groupByEvent(deduplicated);

  for (const [, buckets] of eventGroups) {
    const rep = buckets[0];
    const { source, event_ticker, city, resolution_date } = rep;

    if (await comparisonAlreadyExists(city, resolution_date, source, event_ticker)) {
      result.skipped++;
      continue;
    }

    const forecast = await getLatestForecast(city, resolution_date);
    if (!forecast) {
      result.skipped++;
      continue;
    }

    const implied_temp  = parseFloat(computeImpliedTemp(buckets).toFixed(2));
    const nws_temp      = forecast.max_temp_24h;
    const gap           = parseFloat((implied_temp - nws_temp).toFixed(2));
    const gap_direction = gap > 1 ? "market_warmer" : gap < -1 ? "nws_warmer" : "agree";

    const row: InsertComparison = {
      market_snapshot_id: rep.id,
      forecast_id:        forecast.id,
      city,
      comparison_date:    resolution_date,
      source:             source as "kalshi" | "polymarket",
      series_ticker:      event_ticker,
      implied_temp,
      nws_temp,
      gap,
      gap_direction:      gap_direction as InsertComparison["gap_direction"],
      fetched_at:         fetchedAt,
    };

    await insertComparison(row);
    result.inserted++;
  }

  return result;
}
