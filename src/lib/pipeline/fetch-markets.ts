import { getOpenMarkets } from "../kalshi-client";
import { getActiveMarkets, type PolymarketEvent } from "../polymarket-client";
import { insertMarketSnapshot, type InsertMarketSnapshot } from "../database";
import { CITIES, type CityConfig } from "../cities";

export interface FetchMarketsResult {
  kalshiInserted: number;
  polyInserted:   number;
  kalshiError?:   string;
  polyError?:     string;
}

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

function parseKalshiResolutionDate(eventTicker: string): string {
  const datePart = eventTicker.split("-").pop()!;
  const year  = 2000 + parseInt(datePart.slice(0, 2), 10);
  const month = MONTHS[datePart.slice(2, 5).toUpperCase()];
  const day   = datePart.slice(5).padStart(2, "0");
  if (!month) throw new Error(`Unrecognised month in event ticker: ${eventTicker}`);
  return `${year}-${month}-${day}`;
}

function parsePolymarketBracket(groupItemTitle: string): {
  threshold: number;
  strike_type: "greater" | "less" | "between";
  cap_strike: number | null;
} {
  const t = groupItemTitle.replace(/°F/g, "").trim();

  const between = t.match(/^(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)$/);
  if (between) {
    return { threshold: parseFloat(between[1]), strike_type: "between", cap_strike: parseFloat(between[2]) };
  }
  const greater = t.match(/^[≥>]=?\s*(\d+(?:\.\d+)?)$/);
  if (greater) {
    return { threshold: parseFloat(greater[1]), strike_type: "greater", cap_strike: null };
  }
  const less = t.match(/^<=?\s*(\d+(?:\.\d+)?)$/);
  if (less) {
    return { threshold: parseFloat(less[1]), strike_type: "less", cap_strike: null };
  }
  throw new Error(`Could not parse Polymarket bracket: "${groupItemTitle}"`);
}

async function fetchKalshi(fetchedAt: string, city: CityConfig, seriesTicker: string): Promise<number> {
  const markets = await getOpenMarkets(seriesTicker);
  const active  = markets.filter((m) => m.status === "active");

  let inserted = 0;
  for (const m of active) {
    let resolutionDate: string;
    try {
      resolutionDate = parseKalshiResolutionDate(m.eventTicker);
    } catch {
      continue;
    }

    const row: InsertMarketSnapshot = {
      source:          "kalshi",
      series_ticker:   seriesTicker,
      event_ticker:    m.eventTicker,
      market_ticker:   m.ticker,
      resolution_date: resolutionDate,
      city:            city.key,
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
  const events    = await getActiveMarkets("temperature");
  const nycEvents = events.filter((e: PolymarketEvent) => e.seriesSlug === "nyc-daily-weather");

  let inserted = 0;
  for (const event of nycEvents) {
    const resolutionDate = event.endDate.slice(0, 10);
    for (const market of event.markets) {
      let bracket: ReturnType<typeof parsePolymarketBracket>;
      try {
        bracket = parsePolymarketBracket(market.groupItemTitle);
      } catch {
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

export async function runFetchMarkets(): Promise<FetchMarketsResult> {
  const fetchedAt = new Date().toISOString();
  const result: FetchMarketsResult = { kalshiInserted: 0, polyInserted: 0 };

  try {
    for (const city of Object.values(CITIES)) {
      // Snapshot both the daily-high and daily-low series for each city.
      result.kalshiInserted += await fetchKalshi(fetchedAt, city, city.kalshiSeries);
      result.kalshiInserted += await fetchKalshi(fetchedAt, city, city.lowSeries);
    }
  } catch (err) {
    result.kalshiError = (err as Error).message;
  }

  try {
    result.polyInserted = await fetchPolymarket(fetchedAt);
  } catch (err) {
    result.polyError = (err as Error).message;
  }

  return result;
}
