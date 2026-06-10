import { getGridPoint, getForecastHourly, type ForecastPeriod } from "../noaa-client";
import { insertForecast, type InsertForecast } from "../database";
import { supabaseAdmin } from "../supabase";
import { CITIES, type CityConfig } from "../cities";

export interface FetchForecastsResult {
  inserted: number;
  skipped:  number;
}

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

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function getResolutionDates(today: string, cityKey: string): Promise<string[]> {
  // Look back 25h to catch market snapshots from the daily cron regardless of timing skew
  const since = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("market_snapshots")
    .select("resolution_date")
    .eq("city", cityKey)
    .gte("fetched_at", since);

  if (error) throw new Error(`Failed to query market_snapshots: ${error.message}`);
  const dates = new Set((data ?? []).map((r: { resolution_date: string }) => r.resolution_date));

  // Always include today + next 2 days so we fetch NWS data for dates whose Kalshi
  // markets may have opened after the daily cron already ran.
  dates.add(today);
  dates.add(addDays(today, 1));
  dates.add(addDays(today, 2));

  return [...dates].sort();
}

async function forecastAlreadyExists(date: string, cityKey: string): Promise<boolean> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("forecasts")
    .select("id")
    .eq("city", cityKey)
    .eq("forecast_date", date)
    .gte("fetched_at", twoHoursAgo)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Duplicate check failed for ${date}: ${error.message}`);
  return data !== null;
}

export { computeForecastFields };

async function fetchForecastsForCity(
  city: CityConfig,
  fetchedAt: string,
  result: FetchForecastsResult
): Promise<void> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: city.timeZone });

  const dates = await getResolutionDates(today, city.key);
  if (dates.length === 0) return;

  const grid     = await getGridPoint(city.lat, city.lon);
  const forecast = await getForecastHourly(grid.forecastHourlyUrl);

  for (const date of dates) {
    if (await forecastAlreadyExists(date, city.key)) {
      result.skipped++;
      continue;
    }

    const fields = computeForecastFields(forecast.periods, date);
    if (!fields) {
      result.skipped++;
      continue;
    }

    const row: InsertForecast = {
      city:           city.key,
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
}

export async function runFetchForecasts(): Promise<FetchForecastsResult> {
  const fetchedAt = new Date().toISOString();
  const result: FetchForecastsResult = { inserted: 0, skipped: 0 };

  for (const city of Object.values(CITIES)) {
    await fetchForecastsForCity(city, fetchedAt, result);
  }

  return result;
}
