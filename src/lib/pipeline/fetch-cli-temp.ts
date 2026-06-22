import { getCity, DEFAULT_CITY } from "../cities";

// CLI is issued twice daily: preliminary ~4 PM ET, final ~1:30 AM ET next day.
// Version 1 = most recent. Lower version number = later-issued = final report.
// 2 versions per day → daysBack * 2 ≈ version range for that date.
const MAX_SCAN_VERSIONS = 60; // covers ~30 days back

const MONTH_NAMES: Record<string, string> = {
  JANUARY: "01", FEBRUARY: "02", MARCH: "03", APRIL: "04",
  MAY: "05", JUNE: "06", JULY: "07", AUGUST: "08",
  SEPTEMBER: "09", OCTOBER: "10", NOVEMBER: "11", DECEMBER: "12",
};

function cliBaseUrl(cityKey: string): string {
  const city = getCity(cityKey);
  return `https://forecast.weather.gov/product.php?site=${city.cliSite}&product=CLI&issuedby=${city.cliIssuedBy}`;
}

async function fetchCliHtml(version: number, cityKey: string): Promise<string> {
  const url = `${cliBaseUrl(cityKey)}&version=${version}`;
  const delays = [1000, 2000, 4000];
  let lastErr: Error | undefined;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "ForecastGapDashboard/1.0" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err as Error;
      if (attempt < delays.length) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
    }
  }
  throw new Error(`CLI version ${version} failed after retries: ${lastErr!.message}`);
}

export interface CliReport {
  date: string;
  /** Observed daily max (CLI MAXIMUM line) — null if the line is missing. */
  maxTemp: number | null;
  /** Observed daily min (CLI MINIMUM line) — null if the line is missing. */
  minTemp: number | null;
}

function parseCliReport(html: string): CliReport | null {
  const preMatch = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  if (!preMatch) return null;
  const text = preMatch[1];

  // "...THE CENTRAL PARK NY CLIMATE SUMMARY FOR JUNE 3 2026..."
  const dateMatch = text.match(/CLIMATE SUMMARY FOR ([A-Z]+ \d{1,2} \d{4})/);
  if (!dateMatch) return null;

  const parts = dateMatch[1].split(" ");
  const month = MONTH_NAMES[parts[0]];
  if (!month) return null;
  const day = parts[1].padStart(2, "0");
  const year = parts[2];

  // Both observed-value lines share the same format; the trailing \s before the
  // captured number's neighbours guards against matching the summary-block lines
  // (" MAXIMUM TEMPERATURE (F)  ...") which have text, not a number, after the label.
  // "  MAXIMUM         83    120 PM  95    1895  76      7       79"
  const maxMatch = text.match(/^\s+MAXIMUM\s+(\d+)\s/m);
  // "  MINIMUM         65    522 AM  49    1897  66     -1       72"
  const minMatch = text.match(/^\s+MINIMUM\s+(\d+)\s/m);

  return {
    date: `${year}-${month}-${day}`,
    maxTemp: maxMatch ? parseInt(maxMatch[1], 10) : null,
    minTemp: minMatch ? parseInt(minMatch[1], 10) : null,
  };
}

/**
 * Returns the full observed CLI report (max and min temperature, °F) for a
 * given date from the NWS Daily Climate Report (CLI) for a city's settlement
 * station. This is the exact source Kalshi uses to resolve both KXHIGH* (max)
 * and KXLOWT* (min) contracts.
 *
 * Scans CLI versions starting from the estimated version for the target date
 * and takes the first match (= the final report, which has the lower version
 * number vs. the same-day preliminary). A single fetched report yields both the
 * MAXIMUM and MINIMUM lines, so high and low scoring share one network scan.
 *
 * @param targetDate - YYYY-MM-DD, must be a past date (CLI not yet issued for today)
 * @param cityKey - city config key (defaults to nyc); selects CLI site/issuedby
 * @throws if the target date cannot be found within MAX_SCAN_VERSIONS
 */
export async function getCliReport(targetDate: string, cityKey: string = DEFAULT_CITY): Promise<CliReport> {
  // Days between target date and today (UTC noon to avoid DST edge cases)
  const todayMs = Date.now();
  const targetMs = new Date(targetDate + "T12:00:00Z").getTime();
  const daysBack = Math.max(1, Math.round((todayMs - targetMs) / (1000 * 60 * 60 * 24)));

  // Scan a window centered on the estimated version range
  const startVersion = Math.max(2, daysBack * 2 - 3);
  const endVersion = Math.min(daysBack * 2 + 6, MAX_SCAN_VERSIONS);

  for (let version = startVersion; version <= endVersion; version++) {
    const html = await fetchCliHtml(version, cityKey);
    const parsed = parseCliReport(html);
    if (parsed?.date === targetDate) {
      return parsed;
    }
  }

  throw new Error(
    `CLI report not found for ${targetDate} (scanned versions ${startVersion}–${endVersion})`
  );
}

/** Observed daily MAX temperature (°F) — the resolution source for KXHIGH* markets. */
export async function getCliMaxTemp(targetDate: string, cityKey: string = DEFAULT_CITY): Promise<number> {
  const report = await getCliReport(targetDate, cityKey);
  if (report.maxTemp === null) {
    throw new Error(`CLI MAXIMUM line missing for ${targetDate} (${cityKey})`);
  }
  return report.maxTemp;
}

/** Observed daily MIN temperature (°F) — the resolution source for KXLOWT* markets. */
export async function getCliMinTemp(targetDate: string, cityKey: string = DEFAULT_CITY): Promise<number> {
  const report = await getCliReport(targetDate, cityKey);
  if (report.minTemp === null) {
    throw new Error(`CLI MINIMUM line missing for ${targetDate} (${cityKey})`);
  }
  return report.minTemp;
}
