import { NextRequest, NextResponse } from "next/server";
import { getOpenMarkets, type KalshiMarket } from "@/lib/kalshi-client";
import {
  getRecentSnapshotsForSeries,
  getEarliestSnapshotsForDates,
  getLatestSnapshotBatchForDate,
  type MarketSnapshot,
} from "@/lib/database";
import { getCityOrDefault, getViewOrDefault, seriesForView, type CityConfig } from "@/lib/cities";

export const dynamic = "force-dynamic";

const KALSHI_TIMEOUT_MS = 3000;

// ─── Shared types ─────────────────────────────────────────────────────────────

interface Bucket {
  threshold:   number;
  capStrike:   number | null;
  strikeType:  string;
  yesBid:      number;
  midpoint:    number;
}

interface MarketEvent {
  resolutionDate:      string;
  impliedTemp:         number;
  buckets:             Bucket[];
  source:              "live" | "cached" | "resolved";
  fetchedAt:           string;
  snapshotImpliedTemp: number | null;
  snapshotFetchedAt:   string | null;
}

// ─── Implied-temp computation ─────────────────────────────────────────────────

function bucketMidpoint(strikeType: string, threshold: number, capStrike: number | null): number {
  if (strikeType === "between") return (threshold + capStrike!) / 2;
  if (strikeType === "greater") return threshold + 3;
  return (capStrike ?? 0) - 3; // 'less': open lower tail
}

// Logical display order: highest temperature bucket first
function sortBuckets(buckets: Bucket[]): Bucket[] {
  return [...buckets].sort((a, b) => b.midpoint - a.midpoint);
}

function computeImpliedTemp(buckets: Bucket[]): number {
  const total = buckets.reduce((s, b) => s + b.yesBid, 0);
  if (total === 0) return 0;
  return parseFloat(
    buckets.reduce((s, b) => s + (b.yesBid / total) * b.midpoint, 0).toFixed(2)
  );
}

// ─── Date parsing (event ticker → YYYY-MM-DD) ─────────────────────────────────

const MONTH_MAP: Record<string, string> = {
  JAN:"01", FEB:"02", MAR:"03", APR:"04", MAY:"05", JUN:"06",
  JUL:"07", AUG:"08", SEP:"09", OCT:"10", NOV:"11", DEC:"12",
};

function resolutionDateFromTicker(eventTicker: string): string | null {
  const part = eventTicker.split("-").pop();
  const m    = part?.match(/^(\d{2})([A-Z]{3})(\d{2})$/);
  if (!m) return null;
  const month = MONTH_MAP[m[2]];
  if (!month) return null;
  return `20${m[1]}-${month}-${m[3].padStart(2, "0")}`;
}

// ─── Live path ────────────────────────────────────────────────────────────────

async function fetchLiveEvents(city: CityConfig, series: string): Promise<MarketEvent[]> {
  const fetchedAt = new Date().toISOString();

  const markets: KalshiMarket[] = await Promise.race([
    getOpenMarkets(series),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Kalshi timeout")), KALSHI_TIMEOUT_MS)
    ),
  ]);

  const active = markets.filter((m) => m.status === "active");

  // Group by event_ticker
  const byEvent = new Map<string, KalshiMarket[]>();
  for (const m of active) {
    const group = byEvent.get(m.eventTicker) ?? [];
    group.push(m);
    byEvent.set(m.eventTicker, group);
  }

  const events: MarketEvent[] = [];
  for (const [eventTicker, group] of byEvent) {
    const resolutionDate = resolutionDateFromTicker(eventTicker);
    if (!resolutionDate) continue;

    const buckets: Bucket[] = group.map((m) => {
      const strikeType = m.strikeType ?? "greater";
      const threshold  = m.floorStrike ?? 0;
      const capStrike  = m.capStrike;
      return {
        threshold,
        capStrike,
        strikeType,
        yesBid:   m.yesBidDollars,
        midpoint: bucketMidpoint(strikeType, threshold, capStrike),
      };
    });

    events.push({
      resolutionDate,
      impliedTemp:         computeImpliedTemp(buckets),
      buckets:             sortBuckets(buckets),
      source:              "live",
      fetchedAt,
      snapshotImpliedTemp: null,
      snapshotFetchedAt:   null,
    });
  }

  return events.sort((a, b) => a.resolutionDate.localeCompare(b.resolutionDate));
}

// ─── Fallback path (Supabase snapshots) ──────────────────────────────────────

async function fetchCachedEvents(today: string, city: CityConfig, series: string): Promise<MarketEvent[]> {
  const snapshots = await getRecentSnapshotsForSeries(series, city.key, today);
  if (snapshots.length === 0) return [];

  // Dedupe: latest snapshot per (event_ticker, market_ticker)
  const deduped = new Map<string, MarketSnapshot>();
  for (const s of snapshots) {
    const key      = `${s.event_ticker}|${s.market_ticker}`;
    const existing = deduped.get(key);
    if (!existing || s.fetched_at > existing.fetched_at) deduped.set(key, s);
  }

  // Group deduplicated snapshots by resolution_date
  const byDate = new Map<string, { snapshots: MarketSnapshot[]; fetchedAt: string }>();
  for (const s of deduped.values()) {
    const entry = byDate.get(s.resolution_date) ?? { snapshots: [], fetchedAt: s.fetched_at };
    entry.snapshots.push(s);
    if (s.fetched_at > entry.fetchedAt) entry.fetchedAt = s.fetched_at;
    byDate.set(s.resolution_date, entry);
  }

  const events: MarketEvent[] = [];
  for (const [resolutionDate, { snapshots: group, fetchedAt }] of byDate) {
    const buckets: Bucket[] = group.map((s) => ({
      threshold:  s.threshold,
      capStrike:  s.cap_strike,
      strikeType: s.strike_type,
      yesBid:     s.yes_bid,
      midpoint:   bucketMidpoint(s.strike_type, s.threshold, s.cap_strike),
    }));

    events.push({
      resolutionDate,
      impliedTemp:         computeImpliedTemp(buckets),
      buckets:             sortBuckets(buckets),
      source:              "cached",
      fetchedAt,
      snapshotImpliedTemp: null,
      snapshotFetchedAt:   null,
    });
  }

  return events.sort((a, b) => a.resolutionDate.localeCompare(b.resolutionDate));
}

// ─── Resolved path (final snapshot batch for a past date) ────────────────────

async function fetchResolvedEvent(city: CityConfig, date: string, series: string): Promise<MarketEvent[]> {
  const batch = await getLatestSnapshotBatchForDate(series, city.key, date);
  if (batch.length === 0) return [];

  const buckets: Bucket[] = batch.map((s) => ({
    threshold:  s.threshold,
    capStrike:  s.cap_strike,
    strikeType: s.strike_type,
    yesBid:     s.yes_bid,
    midpoint:   bucketMidpoint(s.strike_type, s.threshold, s.cap_strike),
  }));

  return [{
    resolutionDate:      date,
    impliedTemp:         computeImpliedTemp(buckets),
    buckets:             sortBuckets(buckets),
    source:              "resolved",
    fetchedAt:           batch[0].fetched_at,
    snapshotImpliedTemp: null,
    snapshotFetchedAt:   null,
  }];
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const city  = getCityOrDefault(request.nextUrl.searchParams.get("city"));
  const view  = getViewOrDefault(request.nextUrl.searchParams.get("view"));
  const series = seriesForView(city, view);
  const date  = request.nextUrl.searchParams.get("date");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: city.timeZone });

  // Past resolved date: serve the final market_snapshots batch — there is no
  // live market to fetch. Today/tomorrow (or no date) follows the live path.
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date < today) {
    try {
      const events = await fetchResolvedEvent(city, date, series);
      return NextResponse.json({ events });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  try {
    const events = await fetchLiveEvents(city, series);

    // Attach earliest Supabase snapshot per event (best-effort — failures are silent)
    try {
      const dates     = events.map((e) => e.resolutionDate);
      const snapshots = await getEarliestSnapshotsForDates(series, city.key, dates);

      // Group earliest-batch rows by resolution_date
      const byDate = new Map<string, MarketSnapshot[]>();
      for (const s of snapshots) {
        const group = byDate.get(s.resolution_date) ?? [];
        group.push(s);
        byDate.set(s.resolution_date, group);
      }

      for (const event of events) {
        const group = byDate.get(event.resolutionDate);
        if (!group?.length) continue;
        const buckets: Bucket[] = group.map((s) => ({
          threshold:  s.threshold,
          capStrike:  s.cap_strike,
          strikeType: s.strike_type,
          yesBid:     s.yes_bid,
          midpoint:   bucketMidpoint(s.strike_type, s.threshold, s.cap_strike),
        }));
        event.snapshotImpliedTemp = computeImpliedTemp(buckets);
        event.snapshotFetchedAt   = group[0].fetched_at;
      }
    } catch (e) {
      console.error("snapshot fetch failed (non-fatal):", (e as Error).message);
    }

    return NextResponse.json({ events });
  } catch {
    // Kalshi is down, slow, or returned unusable data — serve from Supabase
    try {
      const events = await fetchCachedEvents(today, city, series);
      return NextResponse.json({ events });
    } catch (fallbackErr) {
      return NextResponse.json(
        { error: "Both live fetch and cache unavailable", detail: (fallbackErr as Error).message },
        { status: 503 }
      );
    }
  }
}
