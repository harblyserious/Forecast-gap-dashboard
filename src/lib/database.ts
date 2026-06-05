import { supabaseAdmin } from "./supabase";

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
