import { NextRequest, NextResponse } from "next/server";
import { getAllSnapshotsForDates, getForecastHistoryForDates, type MarketSnapshot } from "@/lib/database";
import { impliedTempFromSnapshots } from "@/lib/implied-temp";
import { hoursToResolution } from "@/lib/resolution-time";
import { getCityOrDefault } from "@/lib/cities";

export const dynamic = "force-dynamic";

// Implied temperature per hourly snapshot batch for one resolution date.
// Powers the "implied temp over time" chart: x = hours to resolution (48→0),
// y = implied °F, with the NWS forecast as a reference line.
export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date");
  const city = getCityOrDefault(request.nextUrl.searchParams.get("city"));
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date param required (YYYY-MM-DD)" }, { status: 400 });
  }

  try {
    const [snapshots, forecasts] = await Promise.all([
      getAllSnapshotsForDates(city.kalshiSeries, city.key, [date]),
      getForecastHistoryForDates(city.key, [date]),
    ]);

    // Each cron run shares one fetched_at — group rows into batches
    const batches = new Map<string, MarketSnapshot[]>();
    for (const s of snapshots) {
      const group = batches.get(s.fetched_at) ?? [];
      group.push(s);
      batches.set(s.fetched_at, group);
    }

    const points = [...batches.entries()]
      .map(([fetchedAt, buckets]) => ({
        fetchedAt,
        hoursToResolution: parseFloat(hoursToResolution(date, fetchedAt, city.timeZone).toFixed(2)),
        impliedTemp: impliedTempFromSnapshots(buckets),
      }))
      .filter((p) => p.impliedTemp > 0 && p.hoursToResolution >= 0)
      .sort((a, b) => b.hoursToResolution - a.hoursToResolution);

    // Latest NWS forecast for the date as the reference line
    const nwsTemp = forecasts.length > 0 ? forecasts[forecasts.length - 1].max_temp_24h : null;

    return NextResponse.json({ date, points, nwsTemp });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
