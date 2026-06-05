const CLI_BASE =
  "https://forecast.weather.gov/product.php?site=OKX&product=CLI&issuedby=NYC";

// CLI is issued twice daily: preliminary ~4 PM ET, final ~1:30 AM ET next day.
// Version 1 = most recent. Lower version number = later-issued = final report.
// 2 versions per day → daysBack * 2 ≈ version range for that date.
const MAX_SCAN_VERSIONS = 60; // covers ~30 days back

const MONTH_NAMES: Record<string, string> = {
  JANUARY: "01", FEBRUARY: "02", MARCH: "03", APRIL: "04",
  MAY: "05", JUNE: "06", JULY: "07", AUGUST: "08",
  SEPTEMBER: "09", OCTOBER: "10", NOVEMBER: "11", DECEMBER: "12",
};

async function fetchCliHtml(version: number): Promise<string> {
  const url = `${CLI_BASE}&version=${version}`;
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

function parseCliReport(html: string): { date: string; maxTemp: number } | null {
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

  // "  MAXIMUM         83    120 PM  95    1895  76      7       79"
  const maxMatch = text.match(/^\s+MAXIMUM\s+(\d+)\s/m);
  if (!maxMatch) return null;

  return {
    date: `${year}-${month}-${day}`,
    maxTemp: parseInt(maxMatch[1], 10),
  };
}

/**
 * Returns the observed max temperature (°F) for a given date from the NWS
 * Daily Climate Report (CLI) for Central Park (KNYC / KOKX). This is the
 * exact source Kalshi uses to resolve KXHIGHNY contracts.
 *
 * Scans CLI versions starting from the estimated version for the target date
 * and takes the first match (= the final report, which has the lower version
 * number vs. the same-day preliminary).
 *
 * @param targetDate - YYYY-MM-DD, must be a past date (CLI not yet issued for today)
 * @throws if the target date cannot be found within MAX_SCAN_VERSIONS
 */
export async function getCliMaxTemp(targetDate: string): Promise<number> {
  // Days between target date and today (UTC noon to avoid DST edge cases)
  const todayMs = Date.now();
  const targetMs = new Date(targetDate + "T12:00:00Z").getTime();
  const daysBack = Math.max(1, Math.round((todayMs - targetMs) / (1000 * 60 * 60 * 24)));

  // Scan a window centered on the estimated version range
  const startVersion = Math.max(2, daysBack * 2 - 3);
  const endVersion = Math.min(daysBack * 2 + 6, MAX_SCAN_VERSIONS);

  for (let version = startVersion; version <= endVersion; version++) {
    const html = await fetchCliHtml(version);
    const parsed = parseCliReport(html);
    if (parsed?.date === targetDate) {
      return parsed.maxTemp;
    }
  }

  throw new Error(
    `CLI max temp not found for ${targetDate} (scanned versions ${startVersion}–${endVersion})`
  );
}
