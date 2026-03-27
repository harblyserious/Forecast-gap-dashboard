import { fetchJson } from "../src/lib/api-client";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const BASE_URL = "https://api.elections.kalshi.com/trade-api/v2";

const WEATHER_KEYWORDS = [
  "temperature", "weather", "rain", "snow", "storm", "hurricane",
  "tornado", "flood", "wind", "frost", "heat", "climate",
  "precipitation", "degrees", "fahrenheit", "celsius", "high temp",
  "sunny", "cloudy", "fog", "blizzard", "drought",
];

interface Series {
  ticker: string;
  title: string;
  category: string;
  frequency: string;
}

interface SeriesListResponse {
  series: Series[];
  cursor: string;
}

interface SeriesSummary {
  ticker: string;
  title: string;
  category: string;
  frequency: string;
}

async function fetchAllSeries(): Promise<Series[]> {
  const all: Series[] = [];
  let cursor = "";
  let page = 1;

  while (true) {
    const url = `${BASE_URL}/series?limit=100${cursor ? `&cursor=${cursor}` : ""}`;
    const data = await fetchJson<SeriesListResponse>(url);
    all.push(...data.series);
    process.stdout.write(`  Page ${page}: fetched ${data.series.length} series (total: ${all.length})\n`);
    if (!data.cursor || data.series.length === 0) break;
    cursor = data.cursor;
    page++;
  }

  return all;
}

async function main() {
  console.log("Fetching all Kalshi series...");
  const allSeries = await fetchAllSeries();
  console.log(`\nTotal series fetched: ${allSeries.length}\n`);

  const weatherSeries = allSeries.filter((s) =>
    WEATHER_KEYWORDS.some(
      (kw) =>
        s.title?.toLowerCase().includes(kw) ||
        s.category?.toLowerCase().includes(kw)
    )
  );
  console.log(`Weather-related series: ${weatherSeries.length}\n`);

  const summary: SeriesSummary[] = weatherSeries.map((s) => ({
    ticker: s.ticker,
    title: s.title,
    category: s.category,
    frequency: s.frequency,
  }));

  const sampleDir = join(__dirname, "sample-data");
  mkdirSync(sampleDir, { recursive: true });
  writeFileSync(join(sampleDir, "kalshi-weather-series.json"), JSON.stringify(summary, null, 2));
  console.log("Results saved to scripts/sample-data/kalshi-weather-series.json\n");

  for (const s of summary) {
    console.log(`Ticker:   ${s.ticker}`);
    console.log(`Title:    ${s.title}`);
    console.log(`Category: ${s.category}`);
    console.log(`Freq:     ${s.frequency}`);
    console.log();
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
