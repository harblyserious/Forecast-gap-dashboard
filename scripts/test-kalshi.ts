import { fetchJson } from "../src/lib/api-client";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const BASE_URL = "https://api.elections.kalshi.com/trade-api/v2";

interface SeriesResponse {
  series: {
    ticker: string;
    title: string;
    category: string;
  };
}

interface Market {
  ticker: string;
  title: string;
  yes_bid_dollars: number;
  volume_fp: number;
  expiration_time: string;
}

interface MarketsResponse {
  markets: Market[];
}

async function main() {
  console.log("Fetching KXHIGHNY series info...");
  const seriesData = await fetchJson<SeriesResponse>(`${BASE_URL}/series/KXHIGHNY`);
  const s = seriesData.series;
  console.log(`Series: ${s.ticker} — ${s.title}`);
  console.log(`Category: ${s.category}\n`);

  console.log("Fetching open markets for KXHIGHNY...");
  const marketsData = await fetchJson<MarketsResponse>(
    `${BASE_URL}/markets?series_ticker=KXHIGHNY&status=open`
  );

  const sampleDir = join(__dirname, "sample-data");
  mkdirSync(sampleDir, { recursive: true });
  const samplePath = join(sampleDir, "kalshi-markets-sample.json");
  writeFileSync(samplePath, JSON.stringify(marketsData, null, 2));
  console.log("Full response saved to scripts/sample-data/kalshi-markets-sample.json\n");

  const markets = marketsData.markets;
  console.log(`Found ${markets.length} open market(s):\n`);

  for (const market of markets) {
    console.log(`Ticker:     ${market.ticker}`);
    console.log(`Title:      ${market.title}`);
    console.log(`Yes Bid:    ${market.yes_bid_dollars}`);
    console.log(`Volume:     ${market.volume_fp}`);
    console.log(`Expiration: ${market.expiration_time}`);
    console.log();
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
