import { NextRequest, NextResponse } from "next/server";
import { runComputeComparisons } from "@/lib/pipeline/compute-comparisons";
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
    const result      = await runComputeComparisons();
    const duration_ms = Date.now() - startedAt;

    await logPipelineRun({
      job_name:      "compute-comparisons",
      status:        "success",
      rows_inserted: result.inserted,
      duration_ms,
    });

    return NextResponse.json({ success: true, inserted: result.inserted, skipped: result.skipped, duration_ms });
  } catch (err) {
    const duration_ms = Date.now() - startedAt;
    const error = (err as Error).message;
    await logPipelineRun({ job_name: "compute-comparisons", status: "failed", error_message: error, duration_ms });
    return NextResponse.json({ success: false, error });
  }
}
