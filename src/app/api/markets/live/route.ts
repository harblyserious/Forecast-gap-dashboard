import { NextResponse } from "next/server";
import { getOpenMarkets, type KalshiMarket } from "@/lib/kalshi-client";
import { getRecentSnapshotsForSeries, getEarliestSnapshotsForDates, type MarketSnapshot } from "@/lib/database";

export const dynamic = "force-dynamic";

const SERIES = "KXHIGHNY";
const CITY   = "nyc";
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
  source:              "live" | "cached";
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

async function fetchLiveEvents(): Promise<MarketEvent[]> {
  const fetchedAt = new Date().toISOString();

  const markets: KalshiMarket[] = await Promise.race([
    getOpenMarkets(SERIES),
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
      buckets,
      source:              "live",
      fetchedAt,
      snapshotImpliedTemp: null,
      snapshotFetchedAt:   null,
    });
  }

  return events.sort((a, b) => a.resolutionDate.localeCompare(b.resolutionDate));
}

// ─── Fallback path (Supabase snapshots) ──────────────────────────────────────

async function fetchCachedEvents(today: string): Promise<MarketEvent[]> {
  const snapshots = await getRecentSnapshotsForSeries(SERIES, CITY, today);
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
      buckets,
      source:              "cached",
      fetchedAt,
      snapshotImpliedTemp: null,
      snapshotFetchedAt:   null,
    });
  }

  return events.sort((a, b) => a.resolutionDate.localeCompare(b.resolutionDate));
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  try {
    const events = await fetchLiveEvents();

    // Attach earliest Supabase snapshot per event (best-effort — failures are silent)
    try {
      const dates     = events.map((e) => e.resolutionDate);
      const snapshots = await getEarliestSnapshotsForDates(SERIES, CITY, dates);

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
      const events = await fetchCachedEvents(today);
      return NextResponse.json({ events });
    } catch (fallbackErr) {
      return NextResponse.json(
        { error: "Both live fetch and cache unavailable", detail: (fallbackErr as Error).message },
        { status: 503 }
      );
    }
  }
}
