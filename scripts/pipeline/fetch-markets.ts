import { getOpenMarkets } from "../../src/lib/kalshi-client";
import { getActiveMarkets, type PolymarketEvent } from "../../src/lib/polymarket-client";
import { insertMarketSnapshot, type InsertMarketSnapshot } from "../../src/lib/database";

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

// Parses resolution date from a Kalshi event ticker.
// Format: YYMONDD — e.g. "KXHIGHNY-26MAY19" → "2026-05-19"
// Do NOT use close_time: UTC conversion causes off-by-one date errors.
function parseKalshiResolutionDate(eventTicker: string): string {
  const datePart = eventTicker.split("-").pop()!;
  const year  = 2000 + parseInt(datePart.slice(0, 2), 10);
  const month = MONTHS[datePart.slice(2, 5).toUpperCase()];
  const day   = datePart.slice(5).padStart(2, "0");
  if (!month) throw new Error(`Unrecognised month in event ticker: ${eventTicker}`);
  return `${year}-${month}-${day}`;
}

// Parses threshold, strike_type, and cap_strike from a Polymarket groupItemTitle.
// Examples: "64–65°F" (en-dash), "≥ 90°F", "< 55°F"
function parsePolymarketBracket(groupItemTitle: string): {
  threshold: number;
  strike_type: "greater" | "less" | "between";
  cap_strike: number | null;
} {
  const t = groupItemTitle.replace(/°F/g, "").trim();

  // Between: "64–65" or "64-65" (handle both en-dash and hyphen)
  const between = t.match(/^(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)$/);
  if (between) {
    return { threshold: parseFloat(between[1]), strike_type: "between", cap_strike: parseFloat(between[2]) };
  }

  // Greater than or equal: "≥ 90" or ">= 90" or "> 90"
  const greater = t.match(/^[≥>]=?\s*(\d+(?:\.\d+)?)$/);
  if (greater) {
    return { threshold: parseFloat(greater[1]), strike_type: "greater", cap_strike: null };
  }

  // Less than: "< 55" or "<= 55"
  const less = t.match(/^<=?\s*(\d+(?:\.\d+)?)$/);
  if (less) {
    return { threshold: parseFloat(less[1]), strike_type: "less", cap_strike: null };
  }

  throw new Error(`Could not parse Polymarket bracket: "${groupItemTitle}"`);
}

async function fetchKalshi(fetchedAt: string): Promise<number> {
  const markets = await getOpenMarkets("KXHIGHNY");
  // Filter client-side: API returns status "active" for open markets
  const active = markets.filter((m) => m.status === "active");

  let inserted = 0;
  for (const m of active) {
    let resolutionDate: string;
    try {
      resolutionDate = parseKalshiResolutionDate(m.eventTicker);
    } catch {
      console.warn(`  [kalshi] Skipping ${m.ticker} — could not parse date from ${m.eventTicker}`);
      continue;
    }

    const row: InsertMarketSnapshot = {
      source:          "kalshi",
      series_ticker:   "KXHIGHNY",
      event_ticker:    m.eventTicker,
      market_ticker:   m.ticker,
      resolution_date: resolutionDate,
      city:            "nyc",
      threshold:       m.floorStrike ?? 0,
      strike_type:     (m.strikeType as "greater" | "less" | "between") ?? "greater",
      cap_strike:      m.capStrike,
      yes_bid:         m.yesBidDollars,
      volume:          m.volumeFp,
      fetched_at:      fetchedAt,
    };

    await insertMarketSnapshot(row);
    inserted++;
  }

  return inserted;
}

async function fetchPolymarket(fetchedAt: string): Promise<number> {
  const events = await getActiveMarkets("temperature");
  const nycEvents = events.filter((e: PolymarketEvent) => e.seriesSlug === "nyc-daily-weather");

  let inserted = 0;
  for (const event of nycEvents) {
    const resolutionDate = event.endDate.slice(0, 10);

    for (const market of event.markets) {
      let bracket: ReturnType<typeof parsePolymarketBracket>;
      try {
        bracket = parsePolymarketBracket(market.groupItemTitle);
      } catch {
        console.warn(`  [polymarket] Skipping "${market.groupItemTitle}" — could not parse bracket`);
        continue;
      }

      const row: InsertMarketSnapshot = {
        source:          "polymarket",
        series_ticker:   event.seriesSlug,
        event_ticker:    event.slug,
        market_ticker:   market.id,
        resolution_date: resolutionDate,
        city:            "nyc",
        threshold:       bracket.threshold,
        strike_type:     bracket.strike_type,
        cap_strike:      bracket.cap_strike,
        yes_bid:         market.outcomePrices[0],
        volume:          market.volume,
        fetched_at:      fetchedAt,
      };

      await insertMarketSnapshot(row);
      inserted++;
    }
  }

  return inserted;
}

async function run() {
  const fetchedAt = new Date().toISOString();
  console.log(`fetch-markets started at ${fetchedAt}\n`);

  let kalshiCount  = 0;
  let kalshiError: string | null = null;
  let polyCount    = 0;
  let polyError: string | null = null;

  try {
    console.log("Fetching Kalshi KXHIGHNY markets...");
    kalshiCount = await fetchKalshi(fetchedAt);
    console.log(`  ✓ Inserted ${kalshiCount} Kalshi snapshots`);
  } catch (err) {
    kalshiError = (err as Error).message;
    console.error(`  ✗ Kalshi failed: ${kalshiError}`);
  }

  try {
    console.log("Fetching Polymarket NYC temperature markets...");
    polyCount = await fetchPolymarket(fetchedAt);
    console.log(`  ✓ Inserted ${polyCount} Polymarket snapshots`);
  } catch (err) {
    polyError = (err as Error).message;
    console.error(`  ✗ Polymarket failed: ${polyError}`);
  }

  console.log(`\nSummary: Kalshi=${kalshiCount} Polymarket=${polyCount}`);

  if (kalshiError && polyError) {
    console.error("Both sources failed — exiting with error.");
    process.exit(1);
  }
}

run();
