import { NextRequest, NextResponse } from "next/server";
import { getGridPoint, getForecastHourly, type Forecast } from "@/lib/noaa-client";
import { getOpenMarkets, type KalshiMarket } from "@/lib/kalshi-client";
import { getLatestComparison, type Comparison } from "@/lib/database";

export const dynamic = "force-dynamic";

const CITY_CONFIGS: Record<string, { lat: number; lon: number; kalshiSeries: string }> = {
  // Central Park coordinates — Kalshi KXHIGHNY resolves against Central Park / NWS Climatological Report
  nyc: { lat: 40.7829, lon: -73.9654, kalshiSeries: "KXHIGHNY" },
};

// ─── Response shapes ──────────────────────────────────────────────────────────

interface DatabaseResponse {
  source: "database";
  city: string;
  comparisonDate: string;
  impliedTemp: number;
  nwsTemp: number;
  gap: number;
  gapDirection: Comparison["gap_direction"];
  seriesTicker: string;
  fetchedAt: string;
}

interface LiveResponse {
  source: "live";
  city: string;
  forecastDate: string;
  noaaForecast: Forecast | null;
  noaaHighTemp: number | null;
  noaaHighTempType: "24hr max" | null;
  kalshiMarkets: KalshiMarket[];
  kalshiMarketDate: string | null;
  fetchedAt: string;
  errors?: Record<string, string>;
}

// ─── Live fallback (original Phase 1 logic) ───────────────────────────────────

async function fetchLive(city: string, config: { lat: number; lon: number; kalshiSeries: string }): Promise<LiveResponse> {
  const fetchedAt = new Date().toISOString();
  const forecastDate = new Date()
    .toLocaleDateString("en-CA", { timeZone: "America/New_York" });
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
    kalshiMarkets = kalshiResult.value.filter((m) => m.status === "active");
  } else {
    errors.kalshi = kalshiResult.reason?.message ?? "Kalshi fetch failed";
  }

  // Derive market date from eventTicker (e.g. "KXHIGHNY-26MAR27" → 2026-03-27).
  // Do not use close_time — UTC conversion causes off-by-one date errors.
  const kalshiMarketDate = (() => {
    const ticker = kalshiMarkets[0]?.eventTicker;
    if (!ticker) return null;
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

  const hourlyPeriodsForDate = kalshiMarketDate && noaaForecast
    ? noaaForecast.periods.filter((p) => {
        const periodDate = new Date(p.startTime)
          .toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        return periodDate === kalshiMarketDate;
      })
    : [];

  const noaaHighTemp = hourlyPeriodsForDate.length > 0
    ? Math.max(...hourlyPeriodsForDate.map((p) => p.temperature))
    : null;

  return {
    source:           "live",
    city,
    forecastDate,
    noaaForecast,
    noaaHighTemp,
    noaaHighTempType: noaaHighTemp !== null ? "24hr max" : null,
    kalshiMarkets,
    kalshiMarketDate,
    fetchedAt,
    ...(Object.keys(errors).length > 0 && { errors }),
  };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const city   = (request.nextUrl.searchParams.get("city") ?? "nyc").toLowerCase();
  const config = CITY_CONFIGS[city];

  if (!config) {
    return NextResponse.json(
      { error: `Unknown city "${city}". Supported: ${Object.keys(CITY_CONFIGS).join(", ")}` },
      { status: 400 }
    );
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  // Try the database first — fast path, resilient to external API outages.
  try {
    const comparison = await getLatestComparison(city, today);

    if (comparison) {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const isFresh = comparison.fetched_at >= twoHoursAgo;

      if (isFresh) {
        const response: DatabaseResponse = {
          source:         "database",
          city,
          comparisonDate: comparison.comparison_date,
          impliedTemp:    comparison.implied_temp,
          nwsTemp:        comparison.nws_temp,
          gap:            comparison.gap,
          gapDirection:   comparison.gap_direction,
          seriesTicker:   comparison.series_ticker,
          fetchedAt:      comparison.fetched_at,
        };
        return NextResponse.json(response);
      }
    }
  } catch {
    // Database unavailable — fall through to live fetch
  }

  // Fall back to live API calls (database empty, stale, or unavailable).
  const liveResponse = await fetchLive(city, config);
  return NextResponse.json(liveResponse);
}
