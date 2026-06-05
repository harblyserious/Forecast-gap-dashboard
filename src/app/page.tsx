"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const DistributionChart = dynamic(
  () => import("@/components/distribution-chart"),
  { ssr: false, loading: () => <div className="h-[280px] animate-pulse rounded-lg bg-slate-800" /> }
);

// ─── Types ────────────────────────────────────────────────────────────────────

interface Bucket {
  threshold: number; capStrike: number | null; strikeType: string;
  yesBid: number; midpoint: number;
}
interface MarketEvent {
  resolutionDate: string; impliedTemp: number; buckets: Bucket[];
  source: "live" | "cached"; fetchedAt: string;
}
interface ForecastRow {
  forecastDate: string; maxTemp24h: number; daytimeHigh: number | null;
  shortForecast: string | null; fetchedAt: string;
}
interface ScoreRow {
  date: string; actualTemp: number; impliedTemp: number; nwsTemp: number;
  marketError: number; nwsError: number; winner: "market" | "nws" | "tie";
}
interface AccuracySummary { marketWins: number; nwsWins: number; ties: number; totalScored: number; }

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
function dateTabLabel(date: string) {
  const today    = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const label    = formatDateShort(date);
  if (date === today)    return `${label} · Today`;
  if (date === tomorrow) return `${label} · Tomorrow`;
  return label;
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}
function todayET() {
  return new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-800 ${className}`} />;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, badge, className = "" }: {
  label: string; value: React.ReactNode; sub?: string; badge?: React.ReactNode; className?: string;
}) {
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-900 px-6 py-5 ${className}`}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">{label}</span>
        {badge}
      </div>
      <div className="text-4xl font-bold tabular-nums">{value}</div>
      {sub && <p className="mt-2 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function LiveBadge({ isLive, fetchedAt }: { isLive: boolean; fetchedAt: string }) {
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
      As of {formatTime(fetchedAt)}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [loading,      setLoading]      = useState(true);
  const [markets,      setMarkets]      = useState<MarketEvent[]>([]);
  const [forecasts,    setForecasts]    = useState<ForecastRow[]>([]);
  const [scores,       setScores]       = useState<ScoreRow[]>([]);
  const [summary,      setSummary]      = useState<AccuracySummary | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    Promise.allSettled([
      fetch("/api/markets/live").then((r)   => r.json()),
      fetch("/api/forecasts/current").then((r) => r.json()),
      fetch("/api/accuracy").then((r)       => r.json()),
    ]).then(([mRes, fRes, aRes]) => {
      if (mRes.status === "fulfilled") {
        const events: MarketEvent[] = mRes.value.events ?? [];
        setMarkets(events);
        // Prefer today's date; fall back to first event with non-trivial buckets
        const todayDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        const preferred = events.find((e) => e.resolutionDate === todayDate)
          ?? events.find((e) => e.resolutionDate > todayDate)
          ?? events[0];
        setSelectedDate(preferred?.resolutionDate ?? null);
      }
      if (fRes.status === "fulfilled") setForecasts(fRes.value.forecasts ?? []);
      if (aRes.status === "fulfilled") {
        setScores(aRes.value.scores ?? []);
        setSummary(aRes.value.summary ?? null);
      }
      setLoading(false);
    });
  }, []);

  const event    = markets.find((e) => e.resolutionDate === selectedDate) ?? null;
  const forecast = forecasts.find((f) => f.forecastDate === selectedDate) ?? null;
  const impliedTemp = event?.impliedTemp ?? null;
  const nwsTemp     = forecast?.maxTemp24h ?? null;
  const gap         = impliedTemp !== null && nwsTemp !== null
    ? parseFloat((impliedTemp - nwsTemp).toFixed(1)) : null;

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Forecast Gap Dashboard
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              NYC prediction markets vs. NWS forecast
            </p>
          </div>
          <div className="text-right text-sm text-slate-500">
            <div className="font-medium text-slate-300">New York City</div>
            <div>{todayET()}</div>
          </div>
        </header>

        {/* ── Date tabs ───────────────────────────────────────────────────── */}
        {markets.length > 1 && (
          <div className="mb-6 flex gap-2">
            {markets.map((e) => (
              <button
                key={e.resolutionDate}
                onClick={() => setSelectedDate(e.resolutionDate)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  selectedDate === e.resolutionDate
                    ? "bg-violet-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                }`}
              >
                {dateTabLabel(e.resolutionDate)}
              </button>
            ))}
          </div>
        )}

        {/* ── Summary cards ───────────────────────────────────────────────── */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Kalshi implied */}
          <SummaryCard
            label="Kalshi Implied"
            className="border-violet-500/20"
            badge={
              loading || !event ? undefined :
              <LiveBadge isLive={event.source === "live"} fetchedAt={event.fetchedAt} />
            }
            value={
              loading ? <Skeleton className="h-9 w-28" /> :
              <span className="text-violet-400">
                {impliedTemp !== null ? `${impliedTemp.toFixed(1)}°F` : "—"}
              </span>
            }
            sub={event ? `KXHIGHNY · ${formatDateShort(event.resolutionDate)}` : undefined}
          />

          {/* NWS forecast */}
          <SummaryCard
            label="NWS Forecast"
            className="border-sky-500/20"
            value={
              loading ? <Skeleton className="h-9 w-24" /> :
              <span className="text-sky-400">
                {nwsTemp !== null ? `${nwsTemp}°F` : "—"}
              </span>
            }
            sub={
              forecast
                ? `24hr max · ${formatDateShort(forecast.forecastDate)} · ${forecast.shortForecast ?? ""}`
                : undefined
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
                Kalshi bucket probabilities (bars) · NWS normal curve σ=3°F (line)
              </p>
            </div>
          </div>
          {loading ? (
            <div className="h-[280px] animate-pulse rounded-lg bg-slate-800" />
          ) : event ? (
            <DistributionChart buckets={event.buckets} nwsTemp={nwsTemp} />
          ) : (
            <div className="flex h-[280px] items-center justify-center text-slate-500 text-sm">
              No market data for this date
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
          ) : summary ? (
            <div className="mb-6 flex flex-wrap gap-6">
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
          ) : null}

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
          Data: Kalshi · NWS/NOAA · Kalshi resolves via NWS CLI Central Park (KNYC)
        </footer>

      </div>
    </div>
  );
}
