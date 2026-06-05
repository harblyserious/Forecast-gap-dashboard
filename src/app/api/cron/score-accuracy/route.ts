import { NextRequest, NextResponse } from "next/server";
import { runScoreAccuracy } from "@/lib/pipeline/score-accuracy";
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
    const result      = await runScoreAccuracy();
    const duration_ms = Date.now() - startedAt;
    const status      = result.errors.length > 0 ? "partial" : "success";

    await logPipelineRun({
      job_name:      "score-accuracy",
      status,
      rows_inserted: result.scored,
      error_message: result.errors.length > 0 ? result.errors.join("; ") : undefined,
      duration_ms,
    });

    return NextResponse.json({
      success: true,
      scored:  result.scored,
      skipped: result.skipped,
      errors:  result.errors,
      duration_ms,
    });
  } catch (err) {
    const duration_ms = Date.now() - startedAt;
    const error = (err as Error).message;
    await logPipelineRun({ job_name: "score-accuracy", status: "failed", error_message: error, duration_ms });
    return NextResponse.json({ success: false, error }, { status: 500 });
  }
}
