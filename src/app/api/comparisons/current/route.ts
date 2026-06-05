import { NextRequest, NextResponse } from "next/server";
import { getUpcomingComparisons } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const city  = (request.nextUrl.searchParams.get("city") ?? "nyc").toLowerCase();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  try {
    const rows = await getUpcomingComparisons(city, today);

    const comparisons = rows.map((r) => ({
      comparisonDate: r.comparison_date,
      impliedTemp:    r.implied_temp,
      nwsTemp:        r.nws_temp,
      gap:            r.gap,
      gapDirection:   r.gap_direction,
      seriesTicker:   r.series_ticker,
      fetchedAt:      r.fetched_at,
    }));

    return NextResponse.json({ comparisons });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
