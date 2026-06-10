import { NextRequest, NextResponse } from "next/server";
import {
  getAccuracyHistory,
  getAllSnapshotsForDates,
  getForecastHistoryForDates,
  type Forecast,
  type MarketSnapshot,
} from "@/lib/database";
import { impliedTempFromSnapshots } from "@/lib/implied-temp";
import { hoursToResolution } from "@/lib/resolution-time";
import { getCityOrDefault } from "@/lib/cities";

export const dynamic = "force-dynamic";

// Horizon buckets: every hour from 48h out to 1h before resolution.
// A snapshot batch counts toward the horizon it's nearest to (±30 min).
const HORIZONS = Array.from({ length: 48 }, (_, i) => 48 - i); // 48..1

interface HorizonPoint {
  hours:     number;
  marketMae: number | null;
  nwsMae:    number | null;
  n:         number;
}

// Mean absolute error per horizon hour across all resolved dates with hourly
// snapshot coverage. Market implied temp is recomputed per snapshot batch;
// NWS error uses the forecast that was current at that batch's fetch time.
export async function GET(request: NextRequest) {
  const daysParam = request.nextUrl.searchParams.get("days");
  const days      = daysParam ? Math.min(Math.max(parseInt(daysParam, 10) || 30, 1), 365) : 30;
  const city      = getCityOrDefault(request.nextUrl.searchParams.get("city"));

  try {
    // Ground truth: scored dates and their observed temps (Kalshi/CLI source)
    const scores = await getAccuracyHistory(days, city.key);
    const actualByDate = new Map<string, number>();
    for (const s of scores) {
      if (s.actual_source === "nws_climatological" && s.city === city.key) {
        actualByDate.set(s.resolution_date, s.actual_temp);
      }
    }
    const dates = [...actualByDate.keys()];
    if (dates.length === 0) return NextResponse.json({ horizons: [], dates: [] });

    const [snapshots, forecasts] = await Promise.all([
      getAllSnapshotsForDates(city.kalshiSeries, city.key, dates),
      getForecastHistoryForDates(city.key, dates),
    ]);

    const forecastsByDate = new Map<string, Forecast[]>();
    for (const f of forecasts) {
      const group = forecastsByDate.get(f.forecast_date) ?? [];
      group.push(f); // already sorted by fetched_at ascending
      forecastsByDate.set(f.forecast_date, group);
    }

    // Group snapshots into per-date hourly batches
    const batchesByDate = new Map<string, Map<string, MarketSnapshot[]>>();
    for (const s of snapshots) {
      let batches = batchesByDate.get(s.resolution_date);
      if (!batches) batchesByDate.set(s.resolution_date, (batches = new Map()));
      const group = batches.get(s.fetched_at) ?? [];
      group.push(s);
      batches.set(s.fetched_at, group);
    }

    // For each (date, horizon): error of the batch nearest that horizon
    const marketErrors = new Map<number, number[]>();
    const nwsErrors    = new Map<number, number[]>();

    for (const [date, batches] of batchesByDate) {
      const actual = actualByDate.get(date)!;

      // Pick nearest batch per horizon (within ±30 min)
      const batchList = [...batches.entries()].map(([fetchedAt, buckets]) => ({
        fetchedAt,
        hours: hoursToResolution(date, fetchedAt, city.timeZone),
        buckets,
      }));

      for (const target of HORIZONS) {
        let best: (typeof batchList)[number] | null = null;
        for (const b of batchList) {
          const delta = Math.abs(b.hours - target);
          if (delta <= 0.5 && (!best || delta < Math.abs(best.hours - target))) best = b;
        }
        if (!best) continue;

        const implied = impliedTempFromSnapshots(best.buckets);
        if (implied <= 0) continue;
        const mErrs = marketErrors.get(target) ?? [];
        mErrs.push(Math.abs(actual - implied));
        marketErrors.set(target, mErrs);

        // NWS forecast that was current at this batch's fetch time
        const history = forecastsByDate.get(date) ?? [];
        let current: Forecast | null = null;
        for (const f of history) {
          if (f.fetched_at <= best.fetchedAt) current = f;
        }
        if (current) {
          const nErrs = nwsErrors.get(target) ?? [];
          nErrs.push(Math.abs(actual - current.max_temp_24h));
          nwsErrors.set(target, nErrs);
        }
      }
    }

    const mae = (errs: number[] | undefined) =>
      errs?.length ? parseFloat((errs.reduce((s, e) => s + e, 0) / errs.length).toFixed(2)) : null;

    const horizons: HorizonPoint[] = HORIZONS.map((hours) => ({
      hours,
      marketMae: mae(marketErrors.get(hours)),
      nwsMae:    mae(nwsErrors.get(hours)),
      n:         marketErrors.get(hours)?.length ?? 0,
    })).filter((h) => h.n > 0);

    return NextResponse.json({ horizons, dates });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
