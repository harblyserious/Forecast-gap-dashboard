import {
  getResolvedComparisons,
  getScoredComparisonIds,
  insertAccuracyScore,
  type Comparison,
  type InsertAccuracyScore,
} from "../database";
import { getCliMaxTemp } from "./fetch-cli-temp";
import { getCityOrDefault } from "../cities";
import { resolutionTimeUtc } from "../resolution-time";

export interface ScoreAccuracyResult {
  scored:  number;
  skipped: number;
  errors:  string[];
}

// Markets resolve when the final NWS CLI report is issued: ~1:30 AM local time
// the day after the resolution date. Midnight local (end of day) + 1.5 hours,
// derived per city timezone — NYC ≈ 05:30 UTC, LA/SF ≈ 08:30 UTC.
function estimateClosetimeUtc(resolutionDate: string, cityKey: string): Date {
  const tz = getCityOrDefault(cityKey).timeZone;
  return new Date(resolutionTimeUtc(resolutionDate, tz).getTime() + 1.5 * 3600 * 1000);
}

// Within a group of comparisons for the same event, return the one whose
// fetched_at is closest to the 24-hour-before-close mark.
function selectHorizonComparison(group: Comparison[]): Comparison {
  if (group.length === 1) return group[0];
  const horizonMs =
    estimateClosetimeUtc(group[0].comparison_date, group[0].city).getTime() - 24 * 3600 * 1000;
  return group.reduce((best, c) => {
    const bestDelta = Math.abs(new Date(best.fetched_at).getTime() - horizonMs);
    const cDelta    = Math.abs(new Date(c.fetched_at).getTime()    - horizonMs);
    return cDelta < bestDelta ? c : best;
  });
}

function computeHorizonHours(comp: Comparison): number {
  const closeMs   = estimateClosetimeUtc(comp.comparison_date, comp.city).getTime();
  const fetchedMs = new Date(comp.fetched_at).getTime();
  return Math.round((closeMs - fetchedMs) / (1000 * 3600));
}

function determineWinner(
  marketError: number,
  nwsError: number
): "market" | "nws" | "tie" {
  if (marketError < nwsError - 0.5) return "market";
  if (nwsError < marketError - 0.5) return "nws";
  return "tie";
}

// Group comparisons by (series_ticker, comparison_date, city, source).
// Each group represents one event — we score one comparison per group.
function groupByEvent(comparisons: Comparison[]): Map<string, Comparison[]> {
  const groups = new Map<string, Comparison[]>();
  for (const c of comparisons) {
    const key   = `${c.series_ticker}|${c.comparison_date}|${c.city}|${c.source}`;
    const group = groups.get(key) ?? [];
    group.push(c);
    groups.set(key, group);
  }
  return groups;
}

export async function runScoreAccuracy(): Promise<ScoreAccuracyResult> {
  const today  = new Date().toISOString().slice(0, 10);
  const result: ScoreAccuracyResult = { scored: 0, skipped: 0, errors: [] };

  const allResolved = await getResolvedComparisons(today);
  if (allResolved.length === 0) return result;

  // Idempotency: find which comparison_ids are already scored
  const scoredIds = await getScoredComparisonIds(allResolved.map((c) => c.id));

  // Group by event and pick the 24hr-horizon comparison for each
  const eventGroups = groupByEvent(allResolved);
  const toScore: Comparison[] = [];

  for (const [, group] of eventGroups) {
    const chosen = selectHorizonComparison(group);
    if (scoredIds.has(chosen.id)) {
      result.skipped++;
      continue;
    }
    toScore.push(chosen);
  }

  // Cache CLI results per city+date to avoid redundant fetches
  const cliCache = new Map<string, number>();

  for (const comp of toScore) {
    try {
      const cacheKey = `${comp.city}|${comp.comparison_date}`;
      let actualTemp = cliCache.get(cacheKey);
      if (actualTemp === undefined) {
        actualTemp = await getCliMaxTemp(comp.comparison_date, comp.city);
        cliCache.set(cacheKey, actualTemp);
      }

      const marketError = parseFloat(Math.abs(actualTemp - comp.implied_temp).toFixed(2));
      const nwsError    = parseFloat(Math.abs(actualTemp - comp.nws_temp).toFixed(2));
      const winner      = determineWinner(marketError, nwsError);

      const row: InsertAccuracyScore = {
        comparison_id:      comp.id,
        city:               comp.city,
        resolution_date:    comp.comparison_date,
        actual_temp:        actualTemp,
        actual_source:      "nws_climatological",
        market_implied_temp: comp.implied_temp,
        nws_forecast_temp:   comp.nws_temp,
        market_error:        marketError,
        nws_error:           nwsError,
        winner,
        horizon_hours:       computeHorizonHours(comp),
        scored_at:           new Date().toISOString(),
      };

      await insertAccuracyScore(row);
      result.scored++;
    } catch (err) {
      result.errors.push(`${comp.comparison_date} (${comp.series_ticker}): ${(err as Error).message}`);
    }
  }

  return result;
}
