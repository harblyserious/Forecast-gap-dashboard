import { getGridPoint, getForecast } from "../src/lib/noaa-client";
import { getSeriesInfo, getOpenMarkets } from "../src/lib/kalshi-client";
import { getActiveMarkets } from "../src/lib/polymarket-client";

interface TestResult {
  name: string;
  ok: boolean;
  durationMs: number;
  detail?: string;
  error?: string;
}

async function run(name: string, fn: () => Promise<string>): Promise<TestResult> {
  const start = Date.now();
  try {
    const detail = await fn();
    return { name, ok: true, durationMs: Date.now() - start, detail };
  } catch (err) {
    return { name, ok: false, durationMs: Date.now() - start, error: (err as Error).message };
  }
}

async function main() {
  console.log("Testing all APIs...\n");

  const results = await Promise.all([
    run("NOAA — grid point (NYC)", async () => {
      const grid = await getGridPoint(40.7128, -74.006);
      return `Grid: ${grid.gridId} (${grid.gridX},${grid.gridY}) — ${grid.city}, ${grid.state}`;
    }),

    run("NOAA — forecast", async () => {
      const grid = await getGridPoint(40.7128, -74.006);
      const forecast = await getForecast(grid.forecastUrl);
      const first = forecast.periods[0];
      return `${forecast.periods.length} periods — first: "${first.name}" ${first.temperature}°${first.temperatureUnit}, ${first.shortForecast}`;
    }),

    run("Kalshi — series info (KXHIGHNY)", async () => {
      const series = await getSeriesInfo("KXHIGHNY");
      return `${series.ticker}: ${series.title} (${series.category}, ${series.frequency})`;
    }),

    run("Kalshi — open markets (KXHIGHNY)", async () => {
      const markets = await getOpenMarkets("KXHIGHNY");
      const first = markets[0];
      return `${markets.length} open markets — first: ${first.ticker} bid=${first.yesBidDollars}`;
    }),

    run("Polymarket — temperature events", async () => {
      const events = await getActiveMarkets("temperature");
      const nyc = events.filter((e) =>
        e.tags.some((t) => t.slug === "new-york-city")
      );
      return `${events.length} total events, ${nyc.length} NYC — e.g. "${nyc[0]?.title ?? events[0]?.title}"`;
    }),
  ]);

  console.log("Results:\n");
  let allOk = true;
  for (const r of results) {
    const status = r.ok ? "✓" : "✗";
    const timing = `${r.durationMs}ms`;
    if (r.ok) {
      console.log(`  ${status} ${r.name} (${timing})`);
      console.log(`      ${r.detail}`);
    } else {
      console.log(`  ${status} ${r.name} (${timing})`);
      console.log(`      ERROR: ${r.error}`);
      allOk = false;
    }
    console.log();
  }

  if (!allOk) process.exit(1);
}

main().catch((err) => {
  console.error("Unexpected error:", err.message);
  process.exit(1);
});
