import { NextRequest, NextResponse } from "next/server";
import { runFetchMarkets } from "@/lib/pipeline/fetch-markets";

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
    const result = await runFetchMarkets();
    const bothFailed = !!(result.kalshiError && result.polyError);

    return NextResponse.json({
      success:        !bothFailed,
      kalshiInserted: result.kalshiInserted,
      polyInserted:   result.polyInserted,
      ...(result.kalshiError && { kalshiError: result.kalshiError }),
      ...(result.polyError   && { polyError:   result.polyError   }),
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message });
  }
}
