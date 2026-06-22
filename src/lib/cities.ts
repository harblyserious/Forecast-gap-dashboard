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
  /** Kalshi daily-low series ticker (resolves against the same CLI report's MINIMUM line). */
  lowSeries: string;
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

// Coordinates are the official NWS station coordinates (api.weather.gov/stations/{id})
// for each market's settlement station — verified against Kalshi settlement_sources
// and live CLI reports on 2026-06-10. NWS grid noted per entry is informational;
// the pipeline derives it from lat/lon via /points at runtime.
export const CITIES: Record<string, CityConfig> = {
  nyc: {
    key: "nyc",
    displayName: "New York City",
    kalshiSeries: "KXHIGHNY",
    lowSeries: "KXLOWTNYC",
    // Central Park — Kalshi KXHIGHNY resolves against Central Park,
    // NOT downtown NYC (40.7128, -74.006 lands on the Hoboken NJ grid)
    lat: 40.7829,
    lon: -73.9654,
    resolutionStation: "KNYC",
    cliSite: "OKX",
    cliIssuedBy: "NYC",
    timeZone: "America/New_York",
  },
  chi: {
    key: "chi",
    displayName: "Chicago",
    kalshiSeries: "KXHIGHCHI",
    lowSeries: "KXLOWTCHI",
    // Midway Airport, NOT O'Hare — grid LOT/72,69
    lat: 41.7842,
    lon: -87.7553,
    resolutionStation: "KMDW",
    cliSite: "LOT",
    cliIssuedBy: "MDW",
    timeZone: "America/Chicago",
  },
  lax: {
    key: "lax",
    displayName: "Los Angeles",
    kalshiSeries: "KXHIGHLAX",
    lowSeries: "KXLOWTLAX",
    // LAX airport, NOT downtown LA (marine layer runs cooler) — grid LOX/149,41
    lat: 33.9381,
    lon: -118.3889,
    resolutionStation: "KLAX",
    cliSite: "LOX",
    cliIssuedBy: "LAX",
    timeZone: "America/Los_Angeles",
  },
  mia: {
    key: "mia",
    displayName: "Miami",
    kalshiSeries: "KXHIGHMIA",
    lowSeries: "KXLOWTMIA",
    // Miami International Airport — grid MFL/105,51
    lat: 25.7906,
    lon: -80.3164,
    resolutionStation: "KMIA",
    cliSite: "MFL",
    cliIssuedBy: "MIA",
    timeZone: "America/New_York",
  },
  sfo: {
    key: "sfo",
    displayName: "San Francisco",
    kalshiSeries: "KXHIGHTSFO", // note the extra T — Kalshi's naming, not a typo
    lowSeries: "KXLOWTSFO",
    // SFO airport, NOT downtown SF (CLI header: "SAN FRANCISCO AIRPORT") — grid MTR/85,98
    lat: 37.6196,
    lon: -122.3656,
    resolutionStation: "KSFO",
    cliSite: "MTR",
    cliIssuedBy: "SFO",
    timeZone: "America/Los_Angeles",
  },
  den: {
    key: "den",
    displayName: "Denver",
    kalshiSeries: "KXHIGHDEN",
    lowSeries: "KXLOWTDEN",
    // Denver International Airport — grid BOU/75,66
    lat: 39.8466,
    lon: -104.6562,
    resolutionStation: "KDEN",
    cliSite: "BOU",
    cliIssuedBy: "DEN",
    timeZone: "America/Denver",
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

/** Which daily extreme a request/series refers to. */
export type TempView = "high" | "low";

/**
 * True when a Kalshi series ticker (e.g. "KXLOWTNYC") or event ticker
 * (e.g. "KXLOWTNYC-26JUN23") refers to a daily-low market. Low series are
 * uniformly prefixed "KXLOWT"; everything else (highs, Polymarket) is a high.
 */
export function isLowSeries(ticker: string | null | undefined): boolean {
  return !!ticker && ticker.trim().toUpperCase().startsWith("KXLOWT");
}

/** Normalizes an arbitrary query-param value to a TempView, defaulting to "high". */
export function getViewOrDefault(value: string | null | undefined): TempView {
  return value?.toLowerCase() === "low" ? "low" : "high";
}

/** The Kalshi series ticker for a city under the given view. */
export function seriesForView(city: CityConfig, view: TempView): string {
  return view === "low" ? city.lowSeries : city.kalshiSeries;
}
