import { NextRequest, NextResponse } from "next/server";
import { getUpcomingForecasts, insertForecast, type Forecast } from "@/lib/database";
import { getGridPoint, getForecastHourly } from "@/lib/noaa-client";
import { computeForecastFields } from "@/lib/pipeline/fetch-forecasts";
import { getCityOrDefault } from "@/lib/cities";

export const dynamic = "force-dynamic";

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const city  = getCityOrDefault(request.nextUrl.searchParams.get("city"));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: city.timeZone });

  try {
    const rows = await getUpcomingForecasts(city.key, today);
    const storedDates = new Set(rows.map((r) => r.forecast_date));

    // Fetch live NWS data for any upcoming date that isn't in Supabase yet.
    // This covers dates whose Kalshi markets opened after the daily cron ran.
    const missing = [today, addDays(today, 1), addDays(today, 2)]
      .filter((d) => !storedDates.has(d));

    if (missing.length > 0) {
      try {
        const fetchedAt = new Date().toISOString();
        const grid      = await getGridPoint(city.lat, city.lon);
        const nws       = await getForecastHourly(grid.forecastHourlyUrl);

        for (const date of missing) {
          const fields = computeForecastFields(nws.periods, date);
          if (!fields) continue;

          const inserted: Forecast = await insertForecast({
            city:           city.key,
            forecast_date:  date,
            max_temp_24h:   fields.max_temp_24h,
            daytime_high:   fields.daytime_high,
            low_temp:       fields.low_temp,
            precip_prob:    fields.precip_prob,
            short_forecast: fields.short_forecast,
            source:         "nws",
            fetched_at:     fetchedAt,
          });
          rows.push(inserted);
        }

        rows.sort((a, b) => a.forecast_date.localeCompare(b.forecast_date));
      } catch (e) {
        // NWS is flaky — continue with whatever Supabase had
        console.error("Live NWS fetch failed:", (e as Error).message);
      }
    }

    const forecasts = rows.map((r) => ({
      forecastDate:  r.forecast_date,
      maxTemp24h:    r.max_temp_24h,
      daytimeHigh:   r.daytime_high,
      shortForecast: r.short_forecast,
      fetchedAt:     r.fetched_at,
    }));

    return NextResponse.json({ forecasts });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
