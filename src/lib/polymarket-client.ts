import { fetchWithRetry } from "./retry";

const BASE_URL = process.env.POLYMARKET_BASE_URL ?? "https://gamma-api.polymarket.com";

export interface PolymarketTag {
  id: number;
  label: string;
  slug: string;
}

export interface PolymarketMarket {
  id: string;
  question: string;
  slug: string;
  /** Temperature bracket label, e.g. "64–65°F". */
  groupItemTitle: string;
  /** Parsed outcome prices as [yesPrice, noPrice] (decimal, e.g. 0.52 = 52%). */
  outcomePrices: [number, number];
  bestBid: number;
  bestAsk: number;
  volume: number;
  endDate: string;
}

export interface PolymarketEvent {
  id: string;
  title: string;
  slug: string;
  /** Groups recurring daily markets under a shared slug (e.g. "nyc-daily-weather"). */
  seriesSlug: string;
  endDate: string;
  /** URL of the resolution source (e.g. Weather Underground / KLGA for NYC temp markets). */
  resolutionSource: string;
  tags: PolymarketTag[];
  markets: PolymarketMarket[];
  liquidity: number;
  volume: number;
}

interface EventApiResponse {
  id: string;
  title: string;
  slug: string;
  seriesSlug: string;
  endDate: string;
  resolutionSource: string;
  tags: PolymarketTag[];
  liquidity: number | string;
  volume: number | string;
  markets: Array<{
    id: string;
    question: string;
    slug: string;
    groupItemTitle: string;
    /** Serialized JSON array of outcome prices, e.g. '["0.52","0.48"]'. */
    outcomePrices: string;
    bestBid: string;
    bestAsk: string;
    volume: string;
    endDate: string;
  }>;
}

function mapEvent(e: EventApiResponse): PolymarketEvent {
  return {
    id: e.id,
    title: e.title,
    slug: e.slug,
    seriesSlug: e.seriesSlug,
    endDate: e.endDate,
    resolutionSource: e.resolutionSource,
    tags: e.tags ?? [],
    liquidity: Number(e.liquidity),
    volume: Number(e.volume),
    markets: e.markets.map((m) => {
      let outcomePrices: [number, number] = [0, 0];
      try {
        const parsed = JSON.parse(m.outcomePrices) as [string, string];
        outcomePrices = [Number(parsed[0]), Number(parsed[1])];
      } catch {
        // outcomePrices remains [0, 0] if parsing fails
      }
      return {
        id: m.id,
        question: m.question,
        slug: m.slug,
        groupItemTitle: m.groupItemTitle,
        outcomePrices,
        bestBid: Number(m.bestBid),
        bestAsk: Number(m.bestAsk),
        volume: Number(m.volume),
        endDate: m.endDate,
      };
    }),
  };
}

/**
 * Fetches active Polymarket events filtered by tag slug.
 *
 * Use tag_slug="temperature" to retrieve daily city-level temperature markets.
 * NYC daily markets are under seriesSlug "nyc-daily-weather" with tag slug "new-york-city".
 *
 * @param tagSlug - The tag slug to filter by (e.g. "temperature", "weather").
 * @param limit - Maximum number of events to return (default 100).
 * @throws If the request fails.
 */
export async function getActiveMarkets(tagSlug: string, limit = 100): Promise<PolymarketEvent[]> {
  try {
    const events = await fetchWithRetry<EventApiResponse[]>(
      `${BASE_URL}/events?closed=false&tag_slug=${encodeURIComponent(tagSlug)}&limit=${limit}`
    );
    return events.map(mapEvent);
  } catch (err) {
    throw new Error(`Polymarket getActiveMarkets(${tagSlug}) failed: ${(err as Error).message}`);
  }
}

/**
 * Looks up a single Polymarket event by its slug.
 *
 * @param slug - The event slug (e.g. "highest-temperature-in-nyc-on-march-27-2026").
 * @returns The matching event, or null if not found.
 * @throws If the request fails for a reason other than a missing event.
 */
export async function searchMarkets(slug: string): Promise<PolymarketEvent | null> {
  try {
    const events = await fetchWithRetry<EventApiResponse[]>(
      `${BASE_URL}/events?slug=${encodeURIComponent(slug)}`
    );
    if (events.length === 0) return null;
    return mapEvent(events[0]);
  } catch (err) {
    throw new Error(`Polymarket searchMarkets(${slug}) failed: ${(err as Error).message}`);
  }
}
