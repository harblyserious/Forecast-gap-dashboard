import { fetchWithRetry } from "./retry";

const BASE_URL = process.env.KALSHI_BASE_URL ?? "https://api.elections.kalshi.com/trade-api/v2";

export interface KalshiSeries {
  ticker: string;
  title: string;
  category: string;
  frequency: string;
}

export interface KalshiMarket {
  ticker: string;
  title: string;
  /** The event this market belongs to (e.g. "KXHIGHNY-26MAR27"). */
  eventTicker: string;
  status: string;
  /** Yes bid as a decimal probability (e.g. 0.72 = 72%). */
  yesBidDollars: number;
  /** Yes ask as a decimal probability. */
  yesAskDollars: number;
  /** No bid as a decimal probability. */
  noBidDollars: number;
  /** No ask as a decimal probability. */
  noAskDollars: number;
  /** Trading volume in fixed-point format. */
  volumeFp: number;
  openInterestFp: number;
  /** ISO timestamp when the market closes for trading (Eastern time boundary). */
  closeTime: string;
  expirationTime: string;
  subtitle: string;
}

interface SeriesApiResponse {
  series: {
    ticker: string;
    title: string;
    category: string;
    frequency: string;
  };
}

interface MarketsApiResponse {
  markets: Array<{
    ticker: string;
    title: string;
    event_ticker: string;
    status: string;
    // Kalshi returns price fields as strings (e.g. "0.7100") despite the field name
    yes_bid_dollars: string | number;
    yes_ask_dollars: string | number;
    no_bid_dollars: string | number;
    no_ask_dollars: string | number;
    volume_fp: string | number;
    open_interest_fp: string | number;
    close_time: string;
    expiration_time: string;
    subtitle: string;
  }>;
  cursor: string;
}

function mapMarket(m: MarketsApiResponse["markets"][number]): KalshiMarket {
  return {
    ticker: m.ticker,
    title: m.title,
    eventTicker: m.event_ticker,
    status: m.status,
    yesBidDollars: parseFloat(String(m.yes_bid_dollars)),
    yesAskDollars: parseFloat(String(m.yes_ask_dollars)),
    noBidDollars: parseFloat(String(m.no_bid_dollars)),
    noAskDollars: parseFloat(String(m.no_ask_dollars)),
    volumeFp: parseFloat(String(m.volume_fp)),
    openInterestFp: parseFloat(String(m.open_interest_fp)),
    closeTime: m.close_time,
    expirationTime: m.expiration_time,
    subtitle: m.subtitle,
  };
}

/**
 * Fetches metadata for a single Kalshi series.
 *
 * @param seriesTicker - The series ticker (e.g. "KXHIGHNY").
 * @throws If the series is not found or the request fails.
 */
export async function getSeriesInfo(seriesTicker: string): Promise<KalshiSeries> {
  try {
    const data = await fetchWithRetry<SeriesApiResponse>(`${BASE_URL}/series/${seriesTicker}`);
    const s = data.series;
    return {
      ticker: s.ticker,
      title: s.title,
      category: s.category,
      frequency: s.frequency,
    };
  } catch (err) {
    throw new Error(`Kalshi getSeriesInfo(${seriesTicker}) failed: ${(err as Error).message}`);
  }
}

/**
 * Fetches all open markets for a given Kalshi series.
 *
 * @param seriesTicker - The series ticker (e.g. "KXHIGHNY").
 * @param limit - Maximum number of markets to return (default 100).
 * @throws If the request fails.
 */
export async function getOpenMarkets(
  seriesTicker: string,
  limit = 100
): Promise<KalshiMarket[]> {
  const url = `${BASE_URL}/markets?series_ticker=${seriesTicker}&status=open&limit=${limit}`;
  try {
    const data = await fetchWithRetry<MarketsApiResponse>(url);
    const markets = data.markets.map(mapMarket);
    console.log(`[kalshi] getOpenMarkets URL: ${url}`);
    console.log(`[kalshi] Returned ${markets.length} markets:`);
    for (const m of markets) {
      console.log(`  ${m.ticker} | event: ${m.eventTicker} | status: ${m.status} | closeTime: ${m.closeTime}`);
    }
    return markets;
  } catch (err) {
    throw new Error(`Kalshi getOpenMarkets(${seriesTicker}) failed: ${(err as Error).message}`);
  }
}

/**
 * Fetches all open markets belonging to a specific Kalshi event.
 *
 * @param eventTicker - The event ticker (e.g. "KXHIGHNY-26MAR27").
 * @throws If the request fails.
 */
export async function getMarketsByEvent(eventTicker: string): Promise<KalshiMarket[]> {
  try {
    const data = await fetchWithRetry<MarketsApiResponse>(
      `${BASE_URL}/markets?event_ticker=${eventTicker}&status=open`
    );
    return data.markets.map(mapMarket);
  } catch (err) {
    throw new Error(`Kalshi getMarketsByEvent(${eventTicker}) failed: ${(err as Error).message}`);
  }
}
