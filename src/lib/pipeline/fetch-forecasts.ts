import { getGridPoint, getForecastHourly, type ForecastPeriod } from "../noaa-client";
import { insertForecast, type InsertForecast } from "../database";
import { supabaseAdmin } from "../supabase";

export interface FetchForecastsResult {
  inserted: number;
  skipped:  number;
}

const NYC_LAT = 40.7829;
const NYC_LON = -73.9654;
const CITY    = "nyc";

function toEasternDate(isoString: string): string {
  return isoString.slice(0, 10);
}

function toLocalHour(isoString: string): number {
  return parseInt(isoString.slice(11, 13), 10);
}

function computeForecastFields(periods: ForecastPeriod[], targetDate: string) {
  const dayPeriods = periods.filter((p) => toEasternDate(p.startTime) === targetDate);
  if (dayPeriods.length === 0) return null;

  const max_temp_24h = Math.max(...dayPeriods.map((p) => p.temperature));

  const daytimePeriods = dayPeriods.filter((p) => {
    const h = toLocalHour(p.startTime);
    return h >= 6 && h < 20;
  });
  const daytime_high = daytimePeriods.length > 0
    ? Math.max(...daytimePeriods.map((p) => p.temperature))
    : null;

  const low_temp = Math.min(...dayPeriods.map((p) => p.temperature));

  const precipValues = daytimePeriods
    .map((p) => p.probabilityOfPrecipitation)
    .filter((v): v is number => v !== null);
  const precip_prob = precipValues.length > 0
    ? Math.round(precipValues.reduce((a, b) => a + b, 0) / precipValues.length)
    : null;

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
  return [...new Set((data ?? []).map((r: { resolution_date: string }) => r.resolution_date))].sort();
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

export async function runFetchForecasts(): Promise<FetchForecastsResult> {
  const fetchedAt = new Date().toISOString();
  const result: FetchForecastsResult = { inserted: 0, skipped: 0 };

  const dates = await getResolutionDates();
  if (dates.length === 0) return result;

  const grid     = await getGridPoint(NYC_LAT, NYC_LON);
  const forecast = await getForecastHourly(grid.forecastHourlyUrl);

  for (const date of dates) {
    if (await forecastAlreadyExists(date)) {
      result.skipped++;
      continue;
    }

    const fields = computeForecastFields(forecast.periods, date);
    if (!fields) {
      result.skipped++;
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
    result.inserted++;
  }

  return result;
}
