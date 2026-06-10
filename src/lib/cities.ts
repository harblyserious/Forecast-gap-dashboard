// Single source of truth for city/series configuration.
// Adding a city = adding one entry here; no code changes elsewhere.
// Verify Kalshi has an active series for the city first
// (see scripts/sample-data/kalshi-weather-series.json).

export interface CityConfig {
  /** Database key, e.g. "nyc" — used in the city column of every table. */
  key: string;
  /** Display name for the frontend. */
  displayName: string;
  /** Kalshi daily-high series ticker. */
  kalshiSeries: string;
  /** NWS grid coordinates — must match the market's resolution station. */
  lat: number;
  lon: number;
  /** Resolution station id (the station the Kalshi market resolves against). */
  resolutionStation: string;
  /** NWS CLI report parameters: forecast office site + issuedby code. */
  cliSite: string;
  cliIssuedBy: string;
  /** IANA timezone for the city's market day. */
  timeZone: string;
}

export const CITIES: Record<string, CityConfig> = {
  nyc: {
    key: "nyc",
    displayName: "New York City",
    kalshiSeries: "KXHIGHNY",
    // Central Park — Kalshi KXHIGHNY resolves against Central Park,
    // NOT downtown NYC (40.7128, -74.006 lands on the Hoboken NJ grid)
    lat: 40.7829,
    lon: -73.9654,
    resolutionStation: "KNYC",
    cliSite: "OKX",
    cliIssuedBy: "NYC",
    timeZone: "America/New_York",
  },
};

export const DEFAULT_CITY = "nyc";

export function getCity(key: string): CityConfig {
  const city = CITIES[key.toLowerCase()];
  if (!city) throw new Error(`Unknown city: ${key}`);
  return city;
}

export function getCityOrDefault(key: string | null | undefined): CityConfig {
  return CITIES[(key ?? DEFAULT_CITY).toLowerCase()] ?? CITIES[DEFAULT_CITY];
}
