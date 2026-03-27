import { fetchWithRetry } from "./retry";

const BASE_URL = process.env.NOAA_BASE_URL ?? "https://api.weather.gov";

export interface GridPoint {
  gridId: string;
  gridX: number;
  gridY: number;
  forecastUrl: string;
  forecastHourlyUrl: string;
  timeZone: string;
  city: string;
  state: string;
}

export interface ForecastPeriod {
  number: number;
  name: string;
  startTime: string;
  endTime: string;
  isDaytime: boolean;
  temperature: number;
  temperatureUnit: string;
  shortForecast: string;
  detailedForecast: string;
  /** Probability of precipitation as a percentage (0–100), or null if unavailable. */
  probabilityOfPrecipitation: number | null;
  windSpeed: string;
  windDirection: string;
}

export interface Forecast {
  generatedAt: string;
  periods: ForecastPeriod[];
}

interface PointsApiResponse {
  properties: {
    gridId: string;
    gridX: number;
    gridY: number;
    forecast: string;
    forecastHourly: string;
    timeZone: string;
    relativeLocation: {
      properties: {
        city: string;
        state: string;
      };
    };
  };
}

interface ForecastApiResponse {
  properties: {
    generatedAt: string;
    periods: Array<{
      number: number;
      name: string;
      startTime: string;
      endTime: string;
      isDaytime: boolean;
      temperature: number;
      temperatureUnit: string;
      shortForecast: string;
      detailedForecast: string;
      probabilityOfPrecipitation: { value: number | null };
      windSpeed: string;
      windDirection: string;
    }>;
  };
}

/**
 * Resolves a lat/lon coordinate to a NOAA grid point.
 * Returns grid metadata including the forecast URL needed for getForecast().
 *
 * @param lat - Latitude (e.g. 40.7128 for NYC)
 * @param lon - Longitude (e.g. -74.0060 for NYC)
 * @throws If the NOAA /points endpoint returns a non-2xx response.
 */
export async function getGridPoint(lat: number, lon: number): Promise<GridPoint> {
  try {
    const data = await fetchWithRetry<PointsApiResponse>(`${BASE_URL}/points/${lat},${lon}`);
    const p = data.properties;
    return {
      gridId: p.gridId,
      gridX: p.gridX,
      gridY: p.gridY,
      forecastUrl: p.forecast,
      forecastHourlyUrl: p.forecastHourly,
      timeZone: p.timeZone,
      city: p.relativeLocation.properties.city,
      state: p.relativeLocation.properties.state,
    };
  } catch (err) {
    throw new Error(`NOAA getGridPoint(${lat}, ${lon}) failed: ${(err as Error).message}`);
  }
}

/**
 * Fetches the hourly forecast from a NOAA forecast URL.
 * Use the forecastHourlyUrl returned by getGridPoint() as the argument.
 * Hourly periods cover 1-hour windows and are suitable for computing a
 * true 24-hour calendar-day max (midnight to midnight ET).
 *
 * @param forecastHourlyUrl - The full hourly forecast URL from a GridPoint response.
 * @throws If the NOAA hourly forecast endpoint returns a non-2xx response.
 */
export async function getForecastHourly(forecastHourlyUrl: string): Promise<Forecast> {
  try {
    const data = await fetchWithRetry<ForecastApiResponse>(forecastHourlyUrl);
    const p = data.properties;
    return {
      generatedAt: p.generatedAt,
      periods: p.periods.map((period) => ({
        number: period.number,
        name: period.name,
        startTime: period.startTime,
        endTime: period.endTime,
        isDaytime: period.isDaytime,
        temperature: period.temperature,
        temperatureUnit: period.temperatureUnit,
        shortForecast: period.shortForecast,
        detailedForecast: period.detailedForecast,
        probabilityOfPrecipitation: period.probabilityOfPrecipitation?.value ?? null,
        windSpeed: period.windSpeed,
        windDirection: period.windDirection,
      })),
    };
  } catch (err) {
    throw new Error(`NOAA getForecastHourly() failed: ${(err as Error).message}`);
  }
}

/**
 * Fetches a 7-day forecast from a NOAA forecast URL.
 * Use the forecastUrl returned by getGridPoint() as the argument.
 *
 * @param forecastUrl - The full forecast URL from a GridPoint response.
 * @throws If the NOAA forecast endpoint returns a non-2xx response.
 */
export async function getForecast(forecastUrl: string): Promise<Forecast> {
  try {
    const data = await fetchWithRetry<ForecastApiResponse>(forecastUrl);
    const p = data.properties;
    return {
      generatedAt: p.generatedAt,
      periods: p.periods.map((period) => ({
        number: period.number,
        name: period.name,
        startTime: period.startTime,
        endTime: period.endTime,
        isDaytime: period.isDaytime,
        temperature: period.temperature,
        temperatureUnit: period.temperatureUnit,
        shortForecast: period.shortForecast,
        detailedForecast: period.detailedForecast,
        probabilityOfPrecipitation: period.probabilityOfPrecipitation?.value ?? null,
        windSpeed: period.windSpeed,
        windDirection: period.windDirection,
      })),
    };
  } catch (err) {
    throw new Error(`NOAA getForecast() failed: ${(err as Error).message}`);
  }
}
