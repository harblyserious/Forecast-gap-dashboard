import { getGridPoint, getForecastHourly, type ForecastPeriod } from "../../src/lib/noaa-client";
import { insertForecast, type InsertForecast } from "../../src/lib/database";
import { supabaseAdmin } from "../../src/lib/supabase";

// Central Park coordinates — Kalshi KXHIGHNY resolves against Central Park.
// Do NOT use 40.7128, -74.006 (that resolves to the Hoboken, NJ grid).
const NYC_LAT = 40.7829;
const NYC_LON = -73.9654;
const CITY    = "nyc";

// Converts an ISO timestamptz string to a "YYYY-MM-DD" date in Eastern time.
// NWS startTime looks like "2026-05-19T01:00:00-04:00" — slice the date portion
// directly from the string rather than converting to UTC, to avoid DST-crossing errors.
function toEasternDate(isoString: string): string {
  // The offset-aware ISO string already encodes local time — take the date part directly.
  return isoString.slice(0, 10);
}

// Returns the hour (0–23) in local time from an NWS ISO timestamp string.
function toLocalHour(isoString: string): number {
  return parseInt(isoString.slice(11, 13), 10);
}

function computeForecastFields(periods: ForecastPeriod[], targetDate: string) {
  const dayPeriods = periods.filter((p) => toEasternDate(p.startTime) === targetDate);

  if (dayPeriods.length === 0) return null;

  // max_temp_24h: true calendar-day high across ALL hourly periods (midnight–midnight ET).
  // This is what Kalshi resolves against — do not substitute daytime_high here.
  const max_temp_24h = Math.max(...dayPeriods.map((p) => p.temperature));

  // daytime_high: 6am–8pm only (context; not used for scoring)
  const daytimePeriods = dayPeriods.filter((p) => {
    const h = toLocalHour(p.startTime);
    return h >= 6 && h < 20;
  });
  const daytime_high = daytimePeriods.length > 0
    ? Math.max(...daytimePeriods.map((p) => p.temperature))
    : null;

  // low_temp: minimum across all hourly periods for the day
  const low_temp = Math.min(...dayPeriods.map((p) => p.temperature));

  // precip_prob: average of non-null daytime precipitation probabilities
  const precipValues = daytimePeriods
    .map((p) => p.probabilityOfPrecipitation)
    .filter((v): v is number => v !== null);
  const precip_prob = precipValues.length > 0
    ? Math.round(precipValues.reduce((a, b) => a + b, 0) / precipValues.length)
    : null;

  // short_forecast: from the first daytime period (typically 6am or 7am period)
  const short_forecast = daytimePeriods[0]?.shortForecast ?? dayPeriods[0]?.shortForecast ?? null;

  return { max_temp_24h, daytime_high, low_temp, precip_prob, short_forecast };
}

async function getResolutionDates(): Promise<string[]> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("market_snapshots")
    .select("resolution_date")
    .gte("fetched_at", twoHoursAgo);

  if (error) throw new Error(`Failed to query market_snapshots: ${error.message}`);

  const dates = [...new Set((data ?? []).map((r: { resolution_date: string }) => r.resolution_date))];
  return dates.sort();
}

async function forecastAlreadyExists(date: string): Promise<boolean> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("forecasts")
    .select("id")
    .eq("city", CITY)
    .eq("forecast_date", date)
    .gte("fetched_at", twoHoursAgo)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Duplicate check failed for ${date}: ${error.message}`);
  return data !== null;
}

async function run() {
  const fetchedAt = new Date().toISOString();
  console.log(`fetch-forecasts started at ${fetchedAt}\n`);

  // Step 1: find dates we need forecasts for
  const dates = await getResolutionDates();
  if (dates.length === 0) {
    console.log("No market_snapshots found in the last 2 hours — nothing to forecast.");
    return;
  }
  console.log(`Resolution dates to forecast: ${dates.join(", ")}\n`);

  // Step 2: fetch grid point once (shared across all dates)
  console.log("Resolving NWS grid point for Central Park...");
  const grid = await getGridPoint(NYC_LAT, NYC_LON);
  console.log(`  Grid: ${grid.gridId} (${grid.gridX},${grid.gridY}) — ${grid.city}, ${grid.state}\n`);

  // Step 3: fetch hourly forecast once (covers ~7 days, enough for all dates)
  console.log("Fetching hourly forecast...");
  const forecast = await getForecastHourly(grid.forecastHourlyUrl);
  console.log(`  ${forecast.periods.length} hourly periods received\n`);

  let inserted = 0;
  let skipped  = 0;

  // Step 4: insert one row per date
  for (const date of dates) {
    const alreadyExists = await forecastAlreadyExists(date);
    if (alreadyExists) {
      console.log(`  skip ${date} — forecast already inserted in the last 2 hours`);
      skipped++;
      continue;
    }

    const fields = computeForecastFields(forecast.periods, date);
    if (!fields) {
      console.warn(`  skip ${date} — no hourly periods found for this date (may be beyond NWS range)`);
      skipped++;
      continue;
    }

    const row: InsertForecast = {
      city:           CITY,
      forecast_date:  date,
      max_temp_24h:   fields.max_temp_24h,
      daytime_high:   fields.daytime_high,
      low_temp:       fields.low_temp,
      precip_prob:    fields.precip_prob,
      short_forecast: fields.short_forecast,
      source:         "nws",
      fetched_at:     fetchedAt,
    };

    await insertForecast(row);
    console.log(`  ✓ ${date} — 24hr max: ${fields.max_temp_24h}°F, daytime high: ${fields.daytime_high}°F, low: ${fields.low_temp}°F`);
    inserted++;
  }

  console.log(`\nSummary: inserted=${inserted} skipped=${skipped}`);
}

run();
