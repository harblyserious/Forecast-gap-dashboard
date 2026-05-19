import { NextRequest, NextResponse } from "next/server";
import { runFetchMarkets } from "@/lib/pipeline/fetch-markets";
import { logPipelineRun } from "@/lib/database";

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

  const startedAt = Date.now();

  try {
    const result      = await runFetchMarkets();
    const duration_ms = Date.now() - startedAt;
    const bothFailed  = !!(result.kalshiError && result.polyError);
    const eitherFailed = !!(result.kalshiError || result.polyError);
    const rows_inserted = result.kalshiInserted + result.polyInserted;

    await logPipelineRun({
      job_name:      "fetch-markets",
      status:        bothFailed ? "failed" : eitherFailed ? "partial" : "success",
      rows_inserted,
      error_message: [result.kalshiError, result.polyError].filter(Boolean).join("; ") || undefined,
      duration_ms,
    });

    return NextResponse.json({
      success:        !bothFailed,
      kalshiInserted: result.kalshiInserted,
      polyInserted:   result.polyInserted,
      duration_ms,
      ...(result.kalshiError && { kalshiError: result.kalshiError }),
      ...(result.polyError   && { polyError:   result.polyError   }),
    });
  } catch (err) {
    const duration_ms = Date.now() - startedAt;
    const error = (err as Error).message;
    await logPipelineRun({ job_name: "fetch-markets", status: "failed", error_message: error, duration_ms });
    return NextResponse.json({ success: false, error });
  }
}
