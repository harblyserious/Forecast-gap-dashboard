"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { CITIES, DEFAULT_CITY, seriesForView, type TempView } from "@/lib/cities";

const DistributionChart = dynamic(
  () => import("@/components/distribution-chart"),
  { ssr: false, loading: () => <div className="h-[280px] animate-pulse rounded-lg bg-slate-800" /> }
);
const LineChart = dynamic(
  () => import("@/components/line-chart"),
  { ssr: false, loading: () => <div className="h-[260px] animate-pulse rounded-lg bg-slate-800" /> }
);

// ─── Types ────────────────────────────────────────────────────────────────────

interface Bucket {
  threshold: number; capStrike: number | null; strikeType: string;
  yesBid: number; midpoint: number;
}
interface MarketEvent {
  resolutionDate: string; impliedTemp: number; buckets: Bucket[];
  source: "live" | "cached" | "resolved"; fetchedAt: string;
  snapshotImpliedTemp: number | null; snapshotFetchedAt: string | null;
}
interface ForecastRow {
  forecastDate: string; maxTemp24h: number; lowTemp: number | null; daytimeHigh: number | null;
  shortForecast: string | null; fetchedAt: string;
}

// Cities whose daily-low Kalshi volume runs below ~5% of their daily-high volume
// (NYC ~4.9%, LA ~2.5%, measured 2026-06-22) — implied lows are noisier there.
const LOW_LIQUIDITY_CITIES = new Set(["nyc", "lax"]);
interface ScoreRow {
  date: string; actualTemp: number; impliedTemp: number; nwsTemp: number;
  marketError: number; nwsError: number; winner: "market" | "nws" | "tie";
}
interface AccuracySummary { marketWins: number; nwsWins: number; ties: number; totalScored: number; }
interface HistoryPoint { fetchedAt: string; hoursToResolution: number; impliedTemp: number; }
interface HorizonPoint { hours: number; marketMae: number | null; nwsMae: number | null; n: number; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function gapTextColor(gap: number | null) {
  if (gap === null) return "text-slate-400";
  return Math.abs(gap) < 1 ? "text-emerald-400" : Math.abs(gap) < 3 ? "text-amber-400" : "text-rose-400";
}
function gapBorderColor(gap: number | null) {
  if (gap === null) return "border-slate-700";
  return Math.abs(gap) < 1 ? "border-emerald-500/40" : Math.abs(gap) < 3 ? "border-amber-500/40" : "border-rose-500/40";
}
function gapLabel(gap: number | null) {
  if (gap === null) return "—";
  if (Math.abs(gap) < 1) return "Markets agree";
  return gap > 0 ? "Market warmer" : "NWS warmer";
}

function winnerStyles(winner: string) {
  if (winner === "market") return "text-emerald-400 bg-emerald-400/10";
  if (winner === "nws")    return "text-sky-400 bg-sky-400/10";
  return "text-slate-400 bg-slate-700/40";
}
function winnerLabel(winner: string) {
  if (winner === "market") return "MARKET";
  if (winner === "nws")    return "NWS";
  return "TIE";
}

function formatDateShort(iso: string) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function dateTabLabel(date: string, timeZone: string) {
  const today    = new Date().toLocaleDateString("en-CA", { timeZone });
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("en-CA", { timeZone });
  const label    = formatDateShort(date);
  if (date === today)    return `${label} · Today`;
  if (date === tomorrow) return `${label} · Tomorrow`;
  return label;
}
// First day with hourly snapshot coverage (hourly crons enabled 2026-06-05,
// first full day 2026-06-06) — past-day views need hourly data to be useful
const HOURLY_DATA_START = "2026-06-06";

function todayDateLocal(timeZone: string) {
  return new Date().toLocaleDateString("en-CA", { timeZone });
}

// Resolved dates from HOURLY_DATA_START through yesterday, newest first
function getPastDates(timeZone: string): string[] {
  const today = todayDateLocal(timeZone);
  const out: string[] = [];
  const d = new Date(HOURLY_DATA_START + "T12:00:00Z");
  for (let iso = HOURLY_DATA_START; iso < today; iso = d.toISOString().slice(0, 10)) {
    out.push(iso);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out.reverse();
}

// Always rendered in the selected city's timezone (matching the NWS "Updated"
// label) — browser-local time is ambiguous when viewing another city's market
function formatTimestamp(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    hour12: true, timeZoneName: "short", timeZone,
  }).format(new Date(iso));
}
// "2:30 PM PDT" in the city's timezone. Includes the fetch date ("Jun 10,
// 2:30 PM PDT") whenever the fetch day differs from the forecast date being
// viewed (e.g. tomorrow's forecast fetched today) or from today (stale fetch)
// — time-only is unambiguous only when both are today.
function formatUpdatedTime(iso: string, timeZone: string, forecastDate: string) {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short", timeZone,
  }).format(d);
  const fetchedDay = d.toLocaleDateString("en-CA", { timeZone });
  if (fetchedDay === forecastDate && fetchedDay === todayDateLocal(timeZone)) return time;
  return `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(d)}, ${time}`;
}

function todayLabel(timeZone: string) {
  return new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone });
}
// After 5 PM local time the market increasingly reflects the observed high
function isAfter5pmLocal(timeZone: string): boolean {
  return parseInt(
    new Date().toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone }),
    10
  ) >= 17;
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-800 ${className}`} />;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, note, badge, className = "" }: {
  label: string; value: React.ReactNode; sub?: string; note?: React.ReactNode;
  badge?: React.ReactNode; className?: string;
}) {
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-900 px-6 py-5 ${className}`}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">{label}</span>
        {badge}
      </div>
      <div className="text-4xl font-bold tabular-nums">{value}</div>
      {sub && <p className="mt-2 text-xs text-slate-500">{sub}</p>}
      {note}
    </div>
  );
}

function LiveBadge({ isLive, fetchedAt, timeZone }: { isLive: boolean; fetchedAt: string; timeZone: string }) {
  if (isLive) {
    return (
      <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        LIVE
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-600/15 px-2 py-0.5 text-xs font-semibold text-amber-400">
      As of {formatTimestamp(fetchedAt, timeZone)}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [cityKey,        setCityKey]        = useState(DEFAULT_CITY);
  const [view,           setView]           = useState<TempView>("high"); // default High on load
  const [loadedKey,      setLoadedKey]      = useState<string | null>(null);
  const [markets,        setMarkets]        = useState<MarketEvent[]>([]);
  const [forecasts,      setForecasts]      = useState<ForecastRow[]>([]);
  const [scores,         setScores]         = useState<ScoreRow[]>([]);
  const [summary,        setSummary]        = useState<AccuracySummary | null>(null);
  const [selectedDate,   setSelectedDate]   = useState<string | null>(null);
  const [marketsError,   setMarketsError]   = useState(false);
  const [forecastsError, setForecastsError] = useState(false);
  const [accuracyError,  setAccuracyError]  = useState(false);
  const [staleData,      setStaleData]      = useState(false);
  const [history,        setHistory]        = useState<HistoryPoint[]>([]);
  const [historyNws,     setHistoryNws]     = useState<number | null>(null);
  const [loadedHistory,  setLoadedHistory]  = useState<string | null>(null);
  const [horizons,       setHorizons]       = useState<HorizonPoint[]>([]);
  const [horizonDays,    setHorizonDays]    = useState(0);
  const [pastOpen,       setPastOpen]       = useState(false);
  // Final snapshot batch for a selected past date, keyed by date so stale
  // results never render and no synchronous state clearing is needed
  const [pastResolved,   setPastResolved]   = useState<{ date: string; view: TempView; event: MarketEvent | null } | null>(null);

  // Loading flags derived from which request keys have completed — avoids
  // synchronous setState inside effects (react-hooks/set-state-in-effect).
  // The key includes view so toggling High/Low re-enters the loading state.
  const viewKey        = `${cityKey}|${view}`;
  const loading        = loadedKey !== viewKey;
  const historyKey     = selectedDate ? `${cityKey}|${view}|${selectedDate}` : null;
  const historyLoading = historyKey !== null && loadedHistory !== historyKey;

  useEffect(() => {
    Promise.allSettled([
      fetch(`/api/markets/live?city=${cityKey}&view=${view}`).then((r) => r.json()),
      fetch(`/api/forecasts/current?city=${cityKey}`).then((r)         => r.json()),
      fetch(`/api/accuracy?city=${cityKey}&view=${view}`).then((r)     => r.json()),
    ]).then(([mRes, fRes, aRes]) => {
      if (mRes.status === "fulfilled" && !mRes.value?.error) {
        const events: MarketEvent[] = mRes.value.events ?? [];
        setMarkets(events);
        setMarketsError(false);
        const todayDate = todayDateLocal(CITIES[cityKey].timeZone);
        const preferred = events.find((e) => e.resolutionDate === todayDate)
          ?? events.find((e) => e.resolutionDate > todayDate)
          ?? events[0];
        setSelectedDate(preferred?.resolutionDate ?? null);
      } else {
        setMarketsError(true);
      }
      if (fRes.status === "fulfilled" && !fRes.value?.error) {
        const rows: ForecastRow[] = fRes.value.forecasts ?? [];
        setForecasts(rows);
        setForecastsError(false);
        // Stale data: most recent forecast fetched >48 hours ago
        const latest = rows.length > 0 ? Math.max(...rows.map((f) => new Date(f.fetchedAt).getTime())) : null;
        setStaleData(latest !== null && Date.now() - latest > 48 * 60 * 60 * 1000);
      } else {
        setForecastsError(true);
        setStaleData(false);
      }
      if (aRes.status === "fulfilled" && !aRes.value?.error) {
        setScores(aRes.value.scores ?? []);
        setSummary(aRes.value.summary ?? null);
      } else {
        setAccuracyError(true);
      }
      setLoadedKey(viewKey);
    });

    fetch(`/api/accuracy/horizons?city=${cityKey}&view=${view}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d?.error) {
          setHorizons(d.horizons ?? []);
          setHorizonDays(d.dates?.length ?? 0);
        }
      })
      .catch(() => {});
  }, [cityKey, view, viewKey]);

  // Implied temp history for the selected date
  useEffect(() => {
    if (!selectedDate) return;
    const key = `${cityKey}|${view}|${selectedDate}`;
    fetch(`/api/markets/history?date=${selectedDate}&city=${cityKey}&view=${view}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d?.error) {
          setHistory(d.points ?? []);
          setHistoryNws(d.nwsTemp ?? null);
        } else {
          setHistory([]);
        }
      })
      .catch(() => setHistory([]))
      .finally(() => setLoadedHistory(key));
  }, [selectedDate, cityKey, view]);

  // Final market state for a selected past date (no live market exists)
  useEffect(() => {
    if (!selectedDate || selectedDate >= todayDateLocal(CITIES[cityKey].timeZone)) return;
    const date = selectedDate;
    const reqView = view;
    fetch(`/api/markets/live?city=${cityKey}&view=${reqView}&date=${date}`)
      .then((r) => r.json())
      .then((d) => {
        const events: MarketEvent[] = d?.error ? [] : d.events ?? [];
        setPastResolved({ date, view: reqView, event: events[0] ?? null });
      })
      .catch(() => setPastResolved({ date, view: reqView, event: null }));
  }, [selectedDate, cityKey, view]);

  // Past-day navigation: resolved dates selectable from the dropdown
  const cityTz         = CITIES[cityKey].timeZone;
  const pastDates      = getPastDates(cityTz);
  const isPastSelected = selectedDate !== null && selectedDate < todayDateLocal(cityTz);
  const selectedScore  = isPastSelected ? scores.find((s) => s.date === selectedDate) ?? null : null;
  const pastResolvedMatches = pastResolved?.date === selectedDate && pastResolved?.view === view;
  const pastEvent      = isPastSelected && pastResolvedMatches ? pastResolved!.event : null;
  const pastLoading    = isPastSelected && !pastResolvedMatches;

  const event       = markets.find((e) => e.resolutionDate === selectedDate) ?? pastEvent;
  const forecast    = forecasts.find((f) => f.forecastDate === selectedDate) ?? null;
  const impliedTemp = event?.impliedTemp ?? null;
  // NWS comparison value: 24hr max for the High view, calendar-day min for Low.
  const forecastNws = forecast ? (view === "low" ? forecast.lowTemp : forecast.maxTemp24h) : null;
  // Past dates fall back to the forecast captured at scoring time
  const nwsTemp     = forecastNws ?? selectedScore?.nwsTemp ?? null;
  const gap         = impliedTemp !== null && nwsTemp !== null
    ? parseFloat((impliedTemp - nwsTemp).toFixed(1)) : null;

  // Late-day: only meaningful when viewing TODAY after 5 PM city-local time —
  // tomorrow's market is still a genuine forecast and past dates are settled
  const isTodaySelected = selectedDate === todayDateLocal(cityTz);
  const lateDay = !loading && isTodaySelected && isAfter5pmLocal(cityTz);

  // Low-temp markets are materially thinner in a couple of cities — warn that
  // the implied temperature may be less reliable there.
  const showLowLiquidity = !loading && view === "low" && LOW_LIQUIDITY_CITIES.has(cityKey);

  // Tail bucket: any single bucket holds >50% of normalized probability
  const hasTailBucket = !loading && event !== null && (() => {
    const total = event.buckets.reduce((s, b) => s + b.yesBid, 0);
    return total > 0 && event.buckets.some((b) => b.yesBid / total > 0.5);
  })();

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Aporetic
              <span className="font-normal text-slate-400"> · Measuring the prediction market gap</span>
            </h1>
            <p className="mt-1 text-base font-medium text-slate-200">
              Markets vs. Meteorologists
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {CITIES[cityKey].displayName} · Prediction markets vs. NWS forecast
            </p>
          </div>
          <div className="text-right text-sm text-slate-500">
            {Object.keys(CITIES).length > 1 ? (
              <select
                value={cityKey}
                onChange={(e) => setCityKey(e.target.value)}
                className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-sm font-medium text-slate-300"
              >
                {Object.values(CITIES).map((c) => (
                  <option key={c.key} value={c.key}>{c.displayName}</option>
                ))}
              </select>
            ) : (
              <div className="font-medium text-slate-300">{CITIES[cityKey].displayName}</div>
            )}
            <div>{todayLabel(cityTz)}</div>
            <a href="/about" className="mt-1 inline-block text-xs text-violet-400 hover:text-violet-300">
              About & methodology →
            </a>
          </div>
        </header>

        {/* ── Stale data warning ──────────────────────────────────────────── */}
        {staleData && (
          <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-400">
            NWS forecast data may be stale — last updated over 48 hours ago
          </div>
        )}

        {/* ── Date tabs + past days dropdown ──────────────────────────────── */}
        {(markets.length > 1 || pastDates.length > 0) && (
          <div className="mb-6 flex flex-wrap items-center gap-2">
            {markets.length > 1 && markets.map((e) => (
              <button
                key={e.resolutionDate}
                onClick={() => setSelectedDate(e.resolutionDate)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  selectedDate === e.resolutionDate
                    ? "bg-violet-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                }`}
              >
                {dateTabLabel(e.resolutionDate, cityTz)}
              </button>
            ))}
            {pastDates.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setPastOpen((o) => !o)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    isPastSelected
                      ? "bg-violet-600 text-white"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                  }`}
                >
                  {isPastSelected ? formatDateShort(selectedDate!) : "Past Days"}
                  <span className="ml-1.5 text-xs">▾</span>
                </button>
                {pastOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setPastOpen(false)} />
                    <div className="absolute left-0 top-full z-20 mt-1 max-h-64 w-36 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-xl">
                      {pastDates.map((d) => (
                        <button
                          key={d}
                          onClick={() => { setSelectedDate(d); setPastOpen(false); }}
                          className={`block w-full px-4 py-1.5 text-left text-sm transition-colors ${
                            selectedDate === d
                              ? "bg-violet-600 text-white"
                              : "text-slate-300 hover:bg-slate-700"
                          }`}
                        >
                          {formatDateShort(d)}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Resolved badge for past dates ───────────────────────────────── */}
        {selectedScore && (
          <div className="-mt-2 mb-6 flex items-center gap-2 text-sm">
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
              Resolved
            </span>
            <span className="text-slate-400">
              Actual: <span className="font-semibold tabular-nums text-slate-200">{selectedScore.actualTemp}°F</span>
            </span>
          </div>
        )}

        {/* ── High / Low toggle ───────────────────────────────────────────── */}
        <div className="mb-4 flex items-center gap-3">
          <div className="inline-flex rounded-lg border border-slate-700 bg-slate-800 p-0.5">
            {(["high", "low"] as TempView[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                  view === v
                    ? "bg-violet-600 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {v === "high" ? "Daily High" : "Daily Low"}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-500">
            {view === "high" ? "Highest temperature" : "Lowest temperature"} · {CITIES[cityKey].displayName}
          </span>
        </div>

        {/* ── Summary cards ───────────────────────────────────────────────── */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Kalshi implied */}
          <SummaryCard
            label="Kalshi Implied"
            className="border-violet-500/20"
            badge={
              loading || pastLoading || !event ? undefined :
              <LiveBadge isLive={event.source === "live"} fetchedAt={event.fetchedAt} timeZone={cityTz} />
            }
            value={
              loading || pastLoading ? <Skeleton className="h-9 w-28" /> :
              marketsError && !isPastSelected ? <span className="text-rose-400 text-xl font-semibold">Unavailable</span> :
              (() => {
                const snap = event?.snapshotImpliedTemp ?? null;
                const snapAt = event?.snapshotFetchedAt ?? null;
                const showSnap = snap !== null && impliedTemp !== null && Math.abs(snap - impliedTemp) >= 0.1;
                return (
                  <span className="flex flex-col gap-0.5">
                    <span className="text-violet-400">
                      {impliedTemp !== null ? `${impliedTemp.toFixed(1)}°F` : "—"}
                    </span>
                    {showSnap && (
                      <span className="text-sm font-semibold text-slate-500 tabular-nums">
                        {`${snap!.toFixed(1)}°F`}
                        <span className="ml-1.5 text-xs font-normal text-slate-600">
                          as of {formatTimestamp(snapAt!, cityTz)}
                        </span>
                      </span>
                    )}
                  </span>
                );
              })()
            }
            sub={
              marketsError && !isPastSelected ? "Could not reach Kalshi" :
              event ? `${seriesForView(CITIES[cityKey], view)} · ${formatDateShort(event.resolutionDate)}${event.source === "resolved" ? " · final" : ""}` :
              undefined
            }
            note={!loading && !marketsError && lateDay ? (
              <p className="mt-1.5 text-xs text-amber-500/80">Market may reflect observed temperature</p>
            ) : undefined}
          />

          {/* NWS forecast */}
          <SummaryCard
            label="NWS Forecast"
            className="border-sky-500/20"
            value={
              loading ? <Skeleton className="h-9 w-24" /> :
              forecastsError ? <span className="text-rose-400 text-xl font-semibold">Unavailable</span> :
              <span className="text-sky-400">
                {nwsTemp !== null ? `${nwsTemp}°F` : "—"}
              </span>
            }
            sub={
              forecastsError ? "Could not reach NWS" :
              forecast ? `${view === "low" ? "24hr min" : "24hr max"} · ${formatDateShort(forecast.forecastDate)} · ${forecast.shortForecast ?? ""} · Updated ${formatUpdatedTime(forecast.fetchedAt, cityTz, forecast.forecastDate)}` :
              undefined
            }
          />

          {/* Gap */}
          <SummaryCard
            label="Gap"
            className={gapBorderColor(gap)}
            value={
              loading ? <Skeleton className="h-9 w-24" /> :
              <span className={gapTextColor(gap)}>
                {gap !== null ? `${gap > 0 ? "+" : ""}${gap}°F` : "—"}
              </span>
            }
            sub={loading ? undefined : gapLabel(gap)}
          />
        </div>

        {/* ── Distribution chart ──────────────────────────────────────────── */}
        <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-100">Market Distribution vs. NWS Forecast</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {event?.source === "resolved"
                  ? "Final market state at resolution · NWS normal curve σ=3°F (line)"
                  : "Kalshi bucket probabilities (bars) · NWS normal curve σ=3°F (line)"}
              </p>
            </div>
          </div>
          {loading || pastLoading ? (
            <div className="h-[280px] animate-pulse rounded-lg bg-slate-800" />
          ) : marketsError && !isPastSelected ? (
            <div className="flex h-[280px] items-center justify-center text-rose-400 text-sm">
              Unable to load market data
            </div>
          ) : event ? (
            <DistributionChart buckets={event.buckets} nwsTemp={nwsTemp} />
          ) : (
            <div className="flex h-[280px] items-center justify-center text-slate-500 text-sm">
              No market data for this date
            </div>
          )}
          {showLowLiquidity && (
            <p className="mt-3 text-xs text-amber-500/80">
              Low temperature market has limited liquidity — implied temperature may be less reliable
            </p>
          )}
          {hasTailBucket && (
            <p className="mt-3 text-xs text-amber-500/80">
              High concentration in one bucket — implied temperature estimate may be less reliable
            </p>
          )}
        </div>

        {/* ── Implied temp over time ──────────────────────────────────────── */}
        <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="mb-4">
            <h2 className="font-semibold text-slate-100">Implied Temperature Over Time</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Kalshi implied temp per hourly snapshot{selectedDate ? ` · ${formatDateShort(selectedDate)}` : ""} · NWS forecast as reference
            </p>
          </div>
          {historyLoading ? (
            <div className="h-[260px] animate-pulse rounded-lg bg-slate-800" />
          ) : history.length >= 2 ? (
            <LineChart
              xLabel="Hours to resolution"
              yUnit="°"
              series={[
                {
                  name: "Kalshi implied",
                  color: "#8b5cf6",
                  points: history.map((p) => ({ x: p.hoursToResolution, y: p.impliedTemp })),
                },
                ...(historyNws !== null && history.length > 0
                  ? [{
                      name: "NWS forecast",
                      color: "#38bdf8",
                      dashed: true,
                      points: [
                        { x: Math.max(...history.map((p) => p.hoursToResolution)), y: historyNws },
                        { x: Math.min(...history.map((p) => p.hoursToResolution)), y: historyNws },
                      ],
                    }]
                  : []),
              ]}
            />
          ) : (
            <div className="flex h-[260px] items-center justify-center text-slate-500 text-sm">
              Not enough hourly snapshots yet for this date
            </div>
          )}
        </div>

        {/* ── Historical accuracy ─────────────────────────────────────────── */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="mb-4 font-semibold text-slate-100">Historical Accuracy</h2>

          {/* Scoreboard */}
          {loading ? (
            <div className="mb-6 flex gap-8">
              <Skeleton className="h-14 w-28" />
              <Skeleton className="h-14 w-28" />
              <Skeleton className="h-14 w-28" />
            </div>
          ) : !accuracyError && summary ? (
            <div className="mb-6">
              <div className="flex flex-wrap gap-6">
                {[
                  { label: "Market", value: summary.marketWins, color: "text-emerald-400" },
                  { label: "NWS",    value: summary.nwsWins,    color: "text-sky-400" },
                  { label: "Tie",    value: summary.ties,       color: "text-slate-400" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex flex-col gap-0.5">
                    <span className={`text-3xl font-bold tabular-nums ${color}`}>{value}</span>
                    <span className="text-xs uppercase tracking-widest text-slate-500">{label}</span>
                  </div>
                ))}
                <div className="flex flex-col gap-0.5 border-l border-slate-700 pl-6">
                  <span className="text-3xl font-bold tabular-nums text-slate-300">{summary.totalScored}</span>
                  <span className="text-xs uppercase tracking-widest text-slate-500">Scored</span>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-600">At 24-hour horizon</p>
            </div>
          ) : null}

          {/* Accuracy by horizon */}
          {horizons.length >= 2 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-slate-200">Accuracy by Horizon</h3>
              <p className="mb-3 text-xs text-slate-500 mt-0.5">
                Mean absolute error vs. hours before resolution · {horizonDays} scored day{horizonDays === 1 ? "" : "s"} ·
                hourly coverage accumulating since Jun 6
              </p>
              <LineChart
                xLabel="Hours to resolution"
                yUnit="°"
                yZeroFloor
                series={[
                  {
                    name: "Market error",
                    color: "#8b5cf6",
                    points: horizons
                      .filter((h) => h.marketMae !== null)
                      .map((h) => ({ x: h.hours, y: h.marketMae! })),
                  },
                  {
                    name: "NWS error",
                    color: "#38bdf8",
                    points: horizons
                      .filter((h) => h.nwsMae !== null)
                      .map((h) => ({ x: h.hours, y: h.nwsMae! })),
                  },
                ]}
              />
            </div>
          )}

          {/* Accuracy table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left">
                  {["Date", "Actual", "Market", "NWS", "Mkt Err", "NWS Err", "Winner"].map((h) => (
                    <th key={h} className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-slate-800/50">
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="py-2 pr-4">
                          <Skeleton className="h-4 w-16" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : accuracyError ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-rose-400 text-sm">
                      Unable to load accuracy data
                    </td>
                  </tr>
                ) : scores.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      No accuracy data yet
                    </td>
                  </tr>
                ) : (
                  scores.map((s) => (
                    <tr key={s.date} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                      <td className="py-2.5 pr-4 font-medium text-slate-300">
                        {formatDateShort(s.date)}
                      </td>
                      <td className="py-2.5 pr-4 tabular-nums text-slate-200">{s.actualTemp}°</td>
                      <td className="py-2.5 pr-4 tabular-nums text-violet-400">{s.impliedTemp}°</td>
                      <td className="py-2.5 pr-4 tabular-nums text-sky-400">{s.nwsTemp}°</td>
                      <td className="py-2.5 pr-4 tabular-nums text-slate-300">{s.marketError}°</td>
                      <td className="py-2.5 pr-4 tabular-nums text-slate-300">{s.nwsError}°</td>
                      <td className="py-2.5 pr-4">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${winnerStyles(s.winner)}`}>
                          {winnerLabel(s.winner)}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <footer className="mt-8 text-center text-xs text-slate-600">
          Data: Kalshi · NWS/NOAA · Kalshi resolves via NWS CLI ({CITIES[cityKey].resolutionStation})
        </footer>

      </div>
    </div>
  );
}
