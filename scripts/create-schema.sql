-- Aporetic (forecast gap dashboard) — Database Schema
--
-- market_snapshots: raw prediction market data captured each pipeline run
-- forecasts:        NWS hourly forecast data captured each pipeline run
-- comparisons:      derived table joining markets to forecasts; what the dashboard reads
-- accuracy_scores:  filled in post-resolution; tracks who was closer, market or NWS
--
-- Run once against your Supabase project to initialize all tables.

-- Required for uuid_generate_v4(); already enabled in Supabase by default
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ─── market_snapshots ────────────────────────────────────────────────────────
-- One row per market per fetch cycle. Append-only — never updated.
-- Key dashboard query fields: city, resolution_date, yes_bid, threshold, strike_type

CREATE TABLE IF NOT EXISTS market_snapshots (
  id              uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  source          text        NOT NULL,                  -- 'kalshi' or 'polymarket'
  series_ticker   text        NOT NULL,                  -- e.g. 'KXHIGHNY'
  event_ticker    text        NOT NULL,                  -- e.g. 'KXHIGHNY-26MAY19'
  market_ticker   text        NOT NULL,                  -- e.g. 'KXHIGHNY-26MAY19-T95'
  resolution_date date        NOT NULL,                  -- date the market resolves
  city            text        NOT NULL,                  -- e.g. 'nyc'
  threshold       numeric     NOT NULL,                  -- temperature threshold in °F
  strike_type     text        NOT NULL,                  -- 'greater', 'less', or 'between'
  cap_strike      numeric,                               -- upper bound for 'between' markets, null otherwise
  yes_bid         numeric     NOT NULL,                  -- implied probability 0–1 (PRIMARY price field)
  volume          numeric,                               -- trading volume; used to filter thin markets
  fetched_at      timestamptz NOT NULL,                  -- when this snapshot was taken
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_snapshots_city            ON market_snapshots (city);
CREATE INDEX IF NOT EXISTS idx_market_snapshots_resolution_date ON market_snapshots (resolution_date);
CREATE INDEX IF NOT EXISTS idx_market_snapshots_fetched_at      ON market_snapshots (fetched_at);
CREATE INDEX IF NOT EXISTS idx_market_snapshots_city_date       ON market_snapshots (city, resolution_date);


-- ─── forecasts ───────────────────────────────────────────────────────────────
-- One row per city per forecast_date per fetch cycle. Append-only — never updated.
-- Key dashboard query field: max_temp_24h (true 24hr calendar-day high, used for Kalshi comparison)
-- daytime_high is stored for context only — do not use it as the primary comparison value.

CREATE TABLE IF NOT EXISTS forecasts (
  id              uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  city            text        NOT NULL,                  -- e.g. 'nyc'
  forecast_date   date        NOT NULL,                  -- the date being forecast
  max_temp_24h    numeric     NOT NULL,                  -- TRUE 24hr high from hourly endpoint (PRIMARY vs Kalshi)
  daytime_high    numeric,                               -- highest temp 6am–8pm (context only, not for scoring)
  low_temp        numeric,                               -- overnight low
  precip_prob     numeric,                               -- probability of precipitation (%)
  short_forecast  text,                                  -- e.g. 'Mostly Sunny'
  source          text        NOT NULL DEFAULT 'nws',
  fetched_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forecasts_city          ON forecasts (city);
CREATE INDEX IF NOT EXISTS idx_forecasts_forecast_date ON forecasts (forecast_date);
CREATE INDEX IF NOT EXISTS idx_forecasts_fetched_at    ON forecasts (fetched_at);
CREATE INDEX IF NOT EXISTS idx_forecasts_city_date     ON forecasts (city, forecast_date);


-- ─── comparisons ─────────────────────────────────────────────────────────────
-- Derived table — output of compute-comparisons pipeline step.
-- This is the primary table the dashboard reads. Never updated in place;
-- re-run compute-comparisons to regenerate.
-- Key dashboard query fields: gap, gap_direction, implied_temp, nws_temp

CREATE TABLE IF NOT EXISTS comparisons (
  id                   uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  market_snapshot_id   uuid        NOT NULL REFERENCES market_snapshots (id),
  forecast_id          uuid        NOT NULL REFERENCES forecasts (id),
  city                 text        NOT NULL,
  comparison_date      date        NOT NULL,
  source               text        NOT NULL,             -- 'kalshi' or 'polymarket'
  series_ticker        text        NOT NULL,
  implied_temp         numeric     NOT NULL,             -- probability-weighted temp from market buckets
  nws_temp             numeric     NOT NULL,             -- max_temp_24h from matched forecast row
  gap                  numeric     NOT NULL,             -- implied_temp minus nws_temp (positive = market warmer)
  gap_direction        text        NOT NULL,             -- 'market_warmer', 'nws_warmer', or 'agree' (<1°F gap)
  fetched_at           timestamptz NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comparisons_city            ON comparisons (city);
CREATE INDEX IF NOT EXISTS idx_comparisons_comparison_date ON comparisons (comparison_date);
CREATE INDEX IF NOT EXISTS idx_comparisons_fetched_at      ON comparisons (fetched_at);
CREATE INDEX IF NOT EXISTS idx_comparisons_city_date       ON comparisons (city, comparison_date);


-- ─── accuracy_scores ─────────────────────────────────────────────────────────
-- Populated after markets resolve. Tracks actual observed temp and scores
-- whether the market or NWS was more accurate. Grows over time as history accumulates.
-- horizon_hours distinguishes scoring methodology (24 = MVP default).

CREATE TABLE IF NOT EXISTS accuracy_scores (
  id                   uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  comparison_id        uuid        NOT NULL REFERENCES comparisons (id),
  city                 text        NOT NULL,
  resolution_date      date        NOT NULL,
  actual_temp          numeric     NOT NULL,             -- observed ground truth temperature
  actual_source        text        NOT NULL,             -- 'nws_climatological' (Kalshi) or 'weather_underground_klga' (Polymarket)
  market_implied_temp  numeric     NOT NULL,             -- copied from comparison row at scoring time
  nws_forecast_temp    numeric     NOT NULL,             -- copied from comparison row at scoring time
  market_error         numeric     NOT NULL,             -- abs(actual_temp - market_implied_temp)
  nws_error            numeric     NOT NULL,             -- abs(actual_temp - nws_forecast_temp)
  winner               text        NOT NULL,             -- 'market', 'nws', or 'tie'
  horizon_hours        integer,                          -- 24 = MVP; future: 48, 12, 6; null = time-weighted avg
  scored_at            timestamptz NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accuracy_scores_city            ON accuracy_scores (city);
CREATE INDEX IF NOT EXISTS idx_accuracy_scores_resolution_date ON accuracy_scores (resolution_date);
CREATE INDEX IF NOT EXISTS idx_accuracy_scores_horizon_hours   ON accuracy_scores (horizon_hours);


-- ─── pipeline_logs ────────────────────────────────────────────────────────────
-- One row per cron job run. Used to monitor pipeline health and diagnose failures.

CREATE TABLE IF NOT EXISTS pipeline_logs (
  id            uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_name      text        NOT NULL,   -- 'fetch-markets', 'fetch-forecasts', 'compute-comparisons'
  status        text        NOT NULL,   -- 'success', 'partial', 'failed'
  rows_inserted integer,
  error_message text,
  duration_ms   integer,
  run_at        timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_logs_job_name ON pipeline_logs (job_name);
CREATE INDEX IF NOT EXISTS idx_pipeline_logs_run_at   ON pipeline_logs (run_at);


-- ─── Row Level Security (enabled May 2026) ───────────────────────────────────
-- Prevents unauthorized writes while allowing public reads.
-- Service role key (used by pipeline) bypasses RLS entirely.
ALTER TABLE market_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE comparisons ENABLE ROW LEVEL SECURITY;
ALTER TABLE accuracy_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read" ON market_snapshots FOR SELECT USING (true);
CREATE POLICY "public read" ON forecasts FOR SELECT USING (true);
CREATE POLICY "public read" ON comparisons FOR SELECT USING (true);
CREATE POLICY "public read" ON accuracy_scores FOR SELECT USING (true);
CREATE POLICY "public read" ON pipeline_logs FOR SELECT USING (true);


-- Required for Supabase Data API access after October 30, 2026
-- Without these, new tables won't be accessible via PostgREST/supabase-js
GRANT ALL ON market_snapshots TO anon, authenticated, service_role;
GRANT ALL ON forecasts TO anon, authenticated, service_role;
GRANT ALL ON comparisons TO anon, authenticated, service_role;
GRANT ALL ON accuracy_scores TO anon, authenticated, service_role;
GRANT ALL ON pipeline_logs TO anon, authenticated, service_role;
