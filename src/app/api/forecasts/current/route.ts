import { NextRequest, NextResponse } from "next/server";
import { getUpcomingForecasts } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const city  = (request.nextUrl.searchParams.get("city") ?? "nyc").toLowerCase();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  try {
    const rows = await getUpcomingForecasts(city, today);

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
