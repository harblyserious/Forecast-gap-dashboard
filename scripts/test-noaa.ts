import { fetchJson } from "../src/lib/api-client";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const POINTS_URL = "https://api.weather.gov/points/40.7128,-74.0060";

interface PointsResponse {
  properties: {
    forecast: string;
  };
}

interface ForecastPeriod {
  name: string;
  temperature: number;
  temperatureUnit: string;
  shortForecast: string;
  probabilityOfPrecipitation: {
    value: number | null;
    unitCode: string;
  };
}

interface ForecastResponse {
  properties: {
    periods: ForecastPeriod[];
  };
}

async function main() {
  console.log("Fetching NOAA points data for NYC...");
  const points = await fetchJson<PointsResponse>(POINTS_URL);
  const forecastUrl = points.properties.forecast;
  console.log(`Forecast URL: ${forecastUrl}\n`);

  console.log("Fetching forecast...");
  const forecast = await fetchJson<ForecastResponse>(forecastUrl);

  const sampleDir = join(__dirname, "sample-data");
  mkdirSync(sampleDir, { recursive: true });
  const samplePath = join(sampleDir, "noaa-forecast-sample.json");
  writeFileSync(samplePath, JSON.stringify(forecast, null, 2));
  console.log(`Full response saved to scripts/sample-data/noaa-forecast-sample.json\n`);

  const periods = forecast.properties.periods.slice(0, 3);

  for (const period of periods) {
    console.log(`Name: ${period.name}`);
    console.log(`Temperature: ${period.temperature}`);
    console.log(`Unit: ${period.temperatureUnit}`);
    console.log(`Short Forecast: ${period.shortForecast}`);
    console.log();
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
