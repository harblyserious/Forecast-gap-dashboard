import { NextRequest, NextResponse } from "next/server";
import { getAccuracyHistory } from "@/lib/database";
import { getCityOrDefault, getViewOrDefault } from "@/lib/cities";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const daysParam = request.nextUrl.searchParams.get("days");
  const days      = daysParam ? Math.min(Math.max(parseInt(daysParam, 10) || 30, 1), 365) : 30;
  const city      = getCityOrDefault(request.nextUrl.searchParams.get("city"));
  const view      = getViewOrDefault(request.nextUrl.searchParams.get("view"));

  try {
    const rows = await getAccuracyHistory(days, city.key, view);

    const scores = rows.map((r) => ({
      date:        r.resolution_date,
      actualTemp:  r.actual_temp,
      impliedTemp: r.market_implied_temp,
      nwsTemp:     r.nws_forecast_temp,
      marketError: r.market_error,
      nwsError:    r.nws_error,
      winner:      r.winner,
      horizonHours: r.horizon_hours,
    }));

    const summary = {
      marketWins:  scores.filter((s) => s.winner === "market").length,
      nwsWins:     scores.filter((s) => s.winner === "nws").length,
      ties:        scores.filter((s) => s.winner === "tie").length,
      totalScored: scores.length,
    };

    return NextResponse.json({ scores, summary });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
