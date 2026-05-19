import { supabaseAdmin } from "../src/lib/supabase";

interface TableHealth {
  table:      string;
  count:      number;
  latestAt:   string | null;
  ageMinutes: number | null;
  threshold:  number | null;   // minutes; null = no freshness check
  status:     "HEALTHY" | "STALE" | "EMPTY" | "—";
}

async function checkTable(
  table: string,
  timestampCol: string,
  thresholdMinutes: number | null
): Promise<TableHealth> {
  const [countResult, latestResult] = await Promise.all([
    supabaseAdmin.from(table).select(timestampCol, { count: "exact" }),
    supabaseAdmin.from(table).select(timestampCol).order(timestampCol, { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (countResult.error) throw new Error(`${table} count failed: ${JSON.stringify(countResult.error)}`);
  if (latestResult.error) throw new Error(`${table} latest failed: ${JSON.stringify(latestResult.error)}`);

  const count     = countResult.count ?? 0;
  const latestAt  = latestResult.data
    ? (latestResult.data as unknown as Record<string, string>)[timestampCol] ?? null
    : null;
  const ageMinutes = latestAt
    ? (Date.now() - new Date(latestAt).getTime()) / 60_000
    : null;

  let status: TableHealth["status"] = "—";
  if (count === 0) {
    status = "EMPTY";
  } else if (thresholdMinutes !== null) {
    status = ageMinutes !== null && ageMinutes <= thresholdMinutes ? "HEALTHY" : "STALE";
  }

  return { table, count, latestAt, ageMinutes, threshold: thresholdMinutes, status };
}

function formatAge(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  return `${(minutes / 60).toFixed(1)}h ago`;
}

function statusLabel(status: TableHealth["status"]): string {
  if (status === "HEALTHY") return "✓ HEALTHY";
  if (status === "STALE")   return "✗ STALE";
  if (status === "EMPTY")   return "⚠ EMPTY";
  return "—";
}

async function run() {
  console.log(`Pipeline health check — ${new Date().toISOString()}\n`);

  const checks = await Promise.all([
    checkTable("market_snapshots", "fetched_at", 90),
    checkTable("forecasts",        "fetched_at", 14 * 60),
    checkTable("comparisons",      "fetched_at", 90),
    checkTable("accuracy_scores",  "scored_at",  null),
  ]);

  const colWidths = { table: 18, count: 8, latest: 30, age: 12, status: 12 };

  const header =
    "Table".padEnd(colWidths.table) +
    "Rows".padEnd(colWidths.count) +
    "Most Recent".padEnd(colWidths.latest) +
    "Age".padEnd(colWidths.age) +
    "Status";

  console.log(header);
  console.log("─".repeat(header.length + 4));

  for (const h of checks) {
    const threshold = h.threshold !== null ? ` (limit: ${h.threshold < 60 ? h.threshold + "m" : h.threshold / 60 + "h"})` : "";
    console.log(
      h.table.padEnd(colWidths.table) +
      String(h.count).padEnd(colWidths.count) +
      (h.latestAt ?? "—").padEnd(colWidths.latest) +
      formatAge(h.ageMinutes).padEnd(colWidths.age) +
      statusLabel(h.status) + threshold
    );
  }

  const anyStale = checks.some((h) => h.status === "STALE" || h.status === "EMPTY");
  console.log(`\nOverall: ${anyStale ? "✗ PIPELINE NEEDS ATTENTION" : "✓ ALL HEALTHY"}`);

  if (anyStale) process.exit(1);
}

run();
