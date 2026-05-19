import { NextRequest, NextResponse } from "next/server";
import { runFetchForecasts } from "@/lib/pipeline/fetch-forecasts";

export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runFetchForecasts();
    return NextResponse.json({ success: true, inserted: result.inserted, skipped: result.skipped });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message });
  }
}
