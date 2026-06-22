import { supabaseAdmin } from "./supabase";
import { isLowSeries, type TempView } from "./cities";

// ─── Row types (match create-schema.sql exactly) ──────────────────────────────

export type MarketSnapshot = {
  id: string;
  source: "kalshi" | "polymarket";
  series_ticker: string;
  event_ticker: string;
  market_ticker: string;
  resolution_date: string;        // ISO date string, e.g. '2026-05-19'
  city: string;
  threshold: number;
  strike_type: "greater" | "less" | "between";
  cap_strike: number | null;
  yes_bid: number;                // implied probability 0–1
  volume: number | null;
  fetched_at: string;             // ISO timestamptz
  created_at: string;
};

export type Forecast = {
  id: string;
  city: string;
  forecast_date: string;
  max_temp_24h: number;           // PRIMARY comparison field vs Kalshi
  daytime_high: number | null;    // context only — not used for scoring
  low_temp: number | null;
  precip_prob: number | null;
  short_forecast: string | null;
  source: string;
  fetched_at: string;
  created_at: string;
};

export type Comparison = {
  id: string;
  market_snapshot_id: string;
  forecast_id: string;
  city: string;
  comparison_date: string;
  source: "kalshi" | "polymarket";
  series_ticker: string;
  implied_temp: number;
  nws_temp: number;
  gap: number;                    // implied_temp - nws_temp; positive = market warmer
  gap_direction: "market_warmer" | "nws_warmer" | "agree";
  fetched_at: string;
  created_at: string;
};

// ─── Insert types (omit server-generated fields) ──────────────────────────────

export type AccuracyScore = {
  id: string;
  comparison_id: string;
  city: string;
  resolution_date: string;
  actual_temp: number;
  actual_source: string;
  market_implied_temp: number;
  nws_forecast_temp: number;
  market_error: number;
  nws_error: number;
  winner: "market" | "nws" | "tie";
  horizon_hours: number | null;
  scored_at: string;
  created_at: string;
};

export type InsertMarketSnapshot = Omit<MarketSnapshot, "id" | "created_at">;
export type InsertForecast       = Omit<Forecast,        "id" | "created_at">;
export type InsertComparison     = Omit<Comparison,      "id" | "created_at">;
export type InsertAccuracyScore  = Omit<AccuracyScore,   "id" | "created_at">;

// ─── Write operations ─────────────────────────────────────────────────────────

export async function insertMarketSnapshot(data: InsertMarketSnapshot): Promise<MarketSnapshot> {
  const { data: row, error } = await supabaseAdmin
    .from("market_snapshots")
    .insert(data)
    .select()
    .single();

  if (error) throw new Error(`insertMarketSnapshot: ${error.message}`);
  return row as MarketSnapshot;
}

export async function insertForecast(data: InsertForecast): Promise<Forecast> {
  const { data: row, error } = await supabaseAdmin
    .from("forecasts")
    .insert(data)
    .select()
    .single();

  if (error) throw new Error(`insertForecast: ${error.message}`);
  return row as Forecast;
}

export async function insertComparison(data: InsertComparison): Promise<Comparison> {
  const { data: row, error } = await supabaseAdmin
    .from("comparisons")
    .insert(data)
    .select()
    .single();

  if (error) throw new Error(`insertComparison: ${error.message}`);
  return row as Comparison;
}

export async function insertAccuracyScore(data: InsertAccuracyScore): Promise<AccuracyScore> {
  const { data: row, error } = await supabaseAdmin
    .from("accuracy_scores")
    .insert(data)
    .select()
    .single();

  if (error) throw new Error(`insertAccuracyScore: ${error.message}`);
  return row as AccuracyScore;
}

// Returns comparison_ids that already have an accuracy_score row.
export async function getScoredComparisonIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await supabaseAdmin
    .from("accuracy_scores")
    .select("comparison_id")
    .in("comparison_id", ids);

  if (error) throw new Error(`getScoredComparisonIds: ${error.message}`);
  return new Set((data ?? []).map((r: { comparison_id: string }) => r.comparison_id));
}

// Returns all comparisons with comparison_date strictly before today.
export async function getResolvedComparisons(today: string): Promise<Comparison[]> {
  const { data, error } = await supabaseAdmin
    .from("comparisons")
    .select("*")
    .lt("comparison_date", today)
    .order("comparison_date", { ascending: true })
    .order("fetched_at",      { ascending: true });

  if (error) throw new Error(`getResolvedComparisons: ${error.message}`);
  return (data ?? []) as Comparison[];
}

// ─── Pipeline logging ─────────────────────────────────────────────────────────

export type PipelineStatus = "success" | "partial" | "failed";

export async function logPipelineRun(entry: {
  job_name:      string;
  status:        PipelineStatus;
  rows_inserted?: number;
  error_message?: string;
  duration_ms?:   number;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from("pipeline_logs")
    .insert({
      job_name:      entry.job_name,
      status:        entry.status,
      rows_inserted: entry.rows_inserted ?? null,
      error_message: entry.error_message ?? null,
      duration_ms:   entry.duration_ms   ?? null,
    });

  // Log failures silently — a broken log writer should never crash the pipeline.
  if (error) console.error(`logPipelineRun failed: ${error.message}`);
}

// ─── Read operations ──────────────────────────────────────────────────────────

// Returns all market snapshots fetched in the last 25 hours for a series/city
// with a resolution_date on or after today. Used by the live-markets fallback.
export async function getRecentSnapshotsForSeries(
  seriesTicker: string,
  city: string,
  today: string
): Promise<MarketSnapshot[]> {
  const since = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("market_snapshots")
    .select("*")
    .eq("series_ticker", seriesTicker)
    .eq("city", city)
    .gte("resolution_date", today)
    .gte("fetched_at", since)
    .order("fetched_at", { ascending: false });

  if (error) throw new Error(`getRecentSnapshotsForSeries: ${error.message}`);
  return (data ?? []) as MarketSnapshot[];
}

// Returns all market_snapshots from the earliest (first-ever) cron batch for
// each of the given resolution_dates. Each cron run shares a single fetched_at
// timestamp, so filtering to the minimum fetched_at per date yields the full
// set of bucket rows from the first time that date was ever fetched.
// Used by /api/markets/live to show an "as of [date]" snapshot alongside live price.
export async function getEarliestSnapshotsForDates(
  seriesTicker: string,
  city: string,
  resolutionDates: string[]
): Promise<MarketSnapshot[]> {
  if (resolutionDates.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("market_snapshots")
    .select("*")
    .eq("series_ticker", seriesTicker)
    .eq("city", city)
    .in("resolution_date", resolutionDates)
    .order("fetched_at", { ascending: true });

  if (error) throw new Error(`getEarliestSnapshotsForDates: ${error.message}`);
  const rows = (data ?? []) as MarketSnapshot[];

  // For each resolution_date, keep only rows from the earliest fetched_at batch
  const earliestByDate = new Map<string, string>();
  for (const r of rows) {
    const prev = earliestByDate.get(r.resolution_date);
    if (!prev || r.fetched_at < prev) earliestByDate.set(r.resolution_date, r.fetched_at);
  }
  return rows.filter((r) => earliestByDate.get(r.resolution_date) === r.fetched_at);
}

// Returns the latest snapshot batch (all bucket rows sharing the most recent
// fetched_at) for one resolution date. For resolved dates this is the final,
// converged end-of-day market state. Used by /api/markets/live?date=.
export async function getLatestSnapshotBatchForDate(
  seriesTicker: string,
  city: string,
  resolutionDate: string
): Promise<MarketSnapshot[]> {
  // Buckets in a batch share one fetched_at; ~15 buckets max per event, so a
  // 50-row window ordered newest-first always contains the full latest batch.
  const { data, error } = await supabaseAdmin
    .from("market_snapshots")
    .select("*")
    .eq("series_ticker", seriesTicker)
    .eq("city", city)
    .eq("resolution_date", resolutionDate)
    .order("fetched_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(`getLatestSnapshotBatchForDate: ${error.message}`);
  const rows = (data ?? []) as MarketSnapshot[];
  if (rows.length === 0) return [];
  return rows.filter((r) => r.fetched_at === rows[0].fetched_at);
}

// Returns ALL snapshots for a series/city across the given resolution dates,
// paginated past Supabase's 1000-row default cap. Used for multi-horizon
// accuracy and implied-temp-over-time, where every hourly batch matters.
export async function getAllSnapshotsForDates(
  seriesTicker: string,
  city: string,
  resolutionDates: string[]
): Promise<MarketSnapshot[]> {
  if (resolutionDates.length === 0) return [];
  const PAGE = 1000;
  const rows: MarketSnapshot[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("market_snapshots")
      .select("*")
      .eq("series_ticker", seriesTicker)
      .eq("city", city)
      .in("resolution_date", resolutionDates)
      .order("fetched_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) throw new Error(`getAllSnapshotsForDates: ${error.message}`);
    rows.push(...((data ?? []) as MarketSnapshot[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// Returns every forecast row (each daily fetch) for the given dates, so callers
// can pick the forecast that was current at an arbitrary point in time.
export async function getForecastHistoryForDates(
  city: string,
  dates: string[]
): Promise<Forecast[]> {
  if (dates.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("forecasts")
    .select("*")
    .eq("city", city)
    .in("forecast_date", dates)
    .order("fetched_at", { ascending: true });

  if (error) throw new Error(`getForecastHistoryForDates: ${error.message}`);
  return (data ?? []) as Forecast[];
}

// Returns the most recent forecast per forecast_date for a city, for dates
// within the last 2 days and forward. Used by /api/forecasts/current.
export async function getUpcomingForecasts(city: string, today: string): Promise<Forecast[]> {
  const yesterday = new Date(today + "T12:00:00Z");
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const since = yesterday.toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from("forecasts")
    .select("*")
    .eq("city", city)
    .gte("forecast_date", since)
    .order("forecast_date", { ascending: true })
    .order("fetched_at",    { ascending: false });

  if (error) throw new Error(`getUpcomingForecasts: ${error.message}`);

  // Keep latest fetched_at per forecast_date
  const seen = new Map<string, Forecast>();
  for (const row of (data ?? []) as Forecast[]) {
    if (!seen.has(row.forecast_date)) seen.set(row.forecast_date, row);
  }
  return [...seen.values()];
}

// Maps comparison ids to their series_ticker (the event ticker, e.g.
// "KXLOWTNYC-26JUN23"). accuracy_scores stores no series, so this is how we
// tell whether a score belongs to a high or low market.
async function getSeriesByComparisonIds(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from("comparisons")
    .select("id, series_ticker")
    .in("id", ids);
  if (error) throw new Error(`getSeriesByComparisonIds: ${error.message}`);
  for (const r of (data ?? []) as { id: string; series_ticker: string }[]) {
    out.set(r.id, r.series_ticker);
  }
  return out;
}

// Returns accuracy_scores for the last N days, ordered newest-first,
// optionally filtered to one city and to one view (high/low). Used by /api/accuracy.
// View filtering joins through comparisons.series_ticker; scores whose series is
// unknown (older rows) default to the high view, since lows did not exist then.
export async function getAccuracyHistory(
  days: number,
  city?: string,
  view?: TempView
): Promise<AccuracyScore[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceDate = since.toISOString().slice(0, 10);

  let query = supabaseAdmin
    .from("accuracy_scores")
    .select("*")
    .gte("resolution_date", sinceDate)
    .order("resolution_date", { ascending: false });
  if (city) query = query.eq("city", city);

  const { data, error } = await query;
  if (error) throw new Error(`getAccuracyHistory: ${error.message}`);
  const rows = (data ?? []) as AccuracyScore[];
  if (!view) return rows;

  const seriesById = await getSeriesByComparisonIds(rows.map((r) => r.comparison_id));
  return rows.filter((r) => isLowSeries(seriesById.get(r.comparison_id)) === (view === "low"));
}

// Returns the most recent comparison per comparison_date for a city,
// within the last 2 days and forward. Used by /api/comparisons/current.
export async function getUpcomingComparisons(city: string, today: string): Promise<Comparison[]> {
  const yesterday = new Date(today + "T12:00:00Z");
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const since = yesterday.toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from("comparisons")
    .select("*")
    .eq("city", city)
    .gte("comparison_date", since)
    .order("comparison_date", { ascending: true })
    .order("fetched_at",      { ascending: false });

  if (error) throw new Error(`getUpcomingComparisons: ${error.message}`);

  // Keep latest fetched_at per comparison_date
  const seen = new Map<string, Comparison>();
  for (const row of (data ?? []) as Comparison[]) {
    if (!seen.has(row.comparison_date)) seen.set(row.comparison_date, row);
  }
  return [...seen.values()];
}

// Returns the most recently fetched comparison for a given city and date.
// Dashboard uses this to display the current gap for today or a specific date.
export async function getLatestComparison(
  city: string,
  date: string           // ISO date string, e.g. '2026-05-19'
): Promise<Comparison | null> {
  const { data, error } = await supabaseAdmin
    .from("comparisons")
    .select("*")
    .eq("city", city)
    .eq("comparison_date", date)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`getLatestComparison: ${error.message}`);
  return data as Comparison | null;
}

// Returns the most recently fetched comparison per day for the last N days.
// Dashboard uses this to render the historical gap chart.
export async function getComparisonHistory(
  city: string,
  days: number
): Promise<Comparison[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceDate = since.toISOString().slice(0, 10);

  const { data, error } = await supabaseAdmin
    .from("comparisons")
    .select("*")
    .eq("city", city)
    .gte("comparison_date", sinceDate)
    .order("comparison_date", { ascending: false })
    .order("fetched_at",      { ascending: false });

  if (error) throw new Error(`getComparisonHistory: ${error.message}`);
  return data as Comparison[];
}
