import { NextRequest, NextResponse } from "next/server";
import { getGridPoint, getForecastHourly, type Forecast } from "@/lib/noaa-client";
import { getOpenMarkets, type KalshiMarket } from "@/lib/kalshi-client";

// Never cache this route — forecast and market data must always be live.
export const dynamic = "force-dynamic";

const CITY_CONFIGS: Record<string, { lat: number; lon: number; kalshiSeries: string }> = {
  // Central Park coordinates — Kalshi KXHIGHNY resolves against Central Park / NWS Climatological Report
  nyc: { lat: 40.7829, lon: -73.9654, kalshiSeries: "KXHIGHNY" },
};

interface WeatherComparisonResponse {
  city: string;
  forecastDate: string;
  noaaForecast: Forecast | null;
  /** The 24-hour calendar-day max temp (midnight–midnight ET) for the Kalshi resolution date. */
  noaaHighTemp: number | null;
  /** Always "24hr max" — the true calendar-day high, matching how Kalshi resolves. */
  noaaHighTempType: "24hr max" | null;
  kalshiMarkets: KalshiMarket[];
  /** The date the Kalshi markets resolve for (YYYY-MM-DD, Eastern time). */
  kalshiMarketDate: string | null;
  fetchedAt: string;
  errors?: Record<string, string>;
}

export async function GET(request: NextRequest) {
  const city = (request.nextUrl.searchParams.get("city") ?? "nyc").toLowerCase();
  const config = CITY_CONFIGS[city];

  if (!config) {
    return NextResponse.json(
      { error: `Unknown city "${city}". Supported: ${Object.keys(CITY_CONFIGS).join(", ")}` },
      { status: 400 }
    );
  }

  const fetchedAt = new Date().toISOString();
  // Use Eastern time for the forecast date — Kalshi markets resolve on NYC time,
  // so the relevant "today" is Eastern, not UTC.
  const forecastDate = new Date()
    .toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // yields YYYY-MM-DD
  const errors: Record<string, string> = {};

  let noaaForecast: Forecast | null = null;
  let kalshiMarkets: KalshiMarket[] = [];

  const [noaaResult, kalshiResult] = await Promise.allSettled([
    (async () => {
      const grid = await getGridPoint(config.lat, config.lon);
      return getForecastHourly(grid.forecastHourlyUrl);
    })(),
    getOpenMarkets(config.kalshiSeries),
  ]);

  if (noaaResult.status === "fulfilled") {
    noaaForecast = noaaResult.value;
  } else {
    errors.noaa = noaaResult.reason?.message ?? "NOAA fetch failed";
  }

  if (kalshiResult.status === "fulfilled") {
    // Filter defensively — the API param requests open markets, but Kalshi returns
    // status "active" (not "open") on the market objects themselves.
    kalshiMarkets = kalshiResult.value.filter((m) => m.status === "active");
  } else {
    errors.kalshi = kalshiResult.reason?.message ?? "Kalshi fetch failed";
  }

  // Derive the market date from eventTicker (e.g. "KXHIGHNY-26MAR27" → 2026-03-27).
  // close_time is unreliable — it's 11:59 PM ET which rolls into the next UTC day.
  const kalshiMarketDate = (() => {
    const ticker = kalshiMarkets[0]?.eventTicker;
    if (!ticker) return null;
    // Last segment: "26MAR27" → year=2026, month=MAR, day=27
    const datePart = ticker.split("-").pop();
    if (!datePart) return null;
    const match = datePart.match(/^(\d{2})([A-Z]{3})(\d{2})$/);
    if (!match) return null;
    const [, yy, mon, dd] = match;
    const monthMap: Record<string, string> = {
      JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
      JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
    };
    const mm = monthMap[mon];
    if (!mm) return null;
    return `20${yy}-${mm}-${dd}`;
  })();

  // Find the 24-hour calendar-day max across all hourly periods for the Kalshi date.
  // Kalshi "highest temperature" resolves against the Central Park NWS Climatological
  // Report, which uses the full calendar day (midnight–midnight ET), not daytime only.
  const hourlyPeriodsForDate = kalshiMarketDate && noaaForecast
    ? noaaForecast.periods.filter((p) => {
        const periodDate = new Date(p.startTime).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        return periodDate === kalshiMarketDate;
      })
    : [];

  const noaaHighTemp = hourlyPeriodsForDate.length > 0
    ? Math.max(...hourlyPeriodsForDate.map((p) => p.temperature))
    : null;

  const noaaHighTempType: "24hr max" | null = noaaHighTemp !== null ? "24hr max" : null;

  const response: WeatherComparisonResponse = {
    city,
    forecastDate,
    noaaForecast,
    noaaHighTemp,
    noaaHighTempType,
    kalshiMarkets,
    kalshiMarketDate,
    fetchedAt,
    ...(Object.keys(errors).length > 0 && { errors }),
  };

  return NextResponse.json(response);
}
