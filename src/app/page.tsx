"use client";

import { useEffect, useState } from "react";
import type { ForecastPeriod } from "@/lib/noaa-client";
import type { KalshiMarket } from "@/lib/kalshi-client";

interface WeatherComparison {
  city: string;
  forecastDate: string;
  noaaForecast: { periods: ForecastPeriod[] } | null;
  noaaHighTemp: number | null;
  noaaHighTempType: "24hr max" | null;
  kalshiMarkets: KalshiMarket[];
  kalshiMarketDate: string | null;
  fetchedAt: string;
  errors?: Record<string, string>;
}

function getImpliedTemp(markets: KalshiMarket[]): number | null {
  if (markets.length === 0) return null;

  const buckets = markets.map((m) => {
    const sub = m.subtitle ?? m.title ?? "";
    const between = sub.match(/(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/);
    const above = sub.match(/[>≥above]+\s*(\d+(?:\.\d+)?)/i);
    const below = sub.match(/[<≤below]+\s*(\d+(?:\.\d+)?)/i);

    let midpoint: number;
    if (between) {
      midpoint = (parseFloat(between[1]) + parseFloat(between[2])) / 2;
    } else if (above) {
      midpoint = parseFloat(above[1]) + 2;
    } else if (below) {
      midpoint = parseFloat(below[1]) - 2;
    } else {
      return null;
    }

    const bid = m.yesBidDollars ?? 0;
    const ask = m.yesAskDollars ?? 0;
    const prob = bid > 0 && ask > 0 ? (bid + ask) / 2 : bid || ask;
    return { midpoint, prob };
  }).filter(Boolean) as { midpoint: number; prob: number }[];

  const total = buckets.reduce((s, b) => s + b.prob, 0);
  if (total === 0) return null;
  return buckets.reduce((s, b) => s + (b.prob / total) * b.midpoint, 0);
}

export default function Home() {
  const [data, setData] = useState<WeatherComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/weather-comparison")
      .then((res) => res.json())
      .then((json) => { setData(json); setLoading(false); })
      .catch((err) => { setFetchError(err.message); setLoading(false); });
  }, []);

  const noaaTemp = data?.noaaHighTemp ?? null;
  const impliedTemp = data ? getImpliedTemp(data.kalshiMarkets) : null;
  const gap = noaaTemp !== null && impliedTemp !== null ? impliedTemp - noaaTemp : null;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Forecast Gap Dashboard</h1>
        <p className="text-sm text-gray-500">NYC — prediction markets vs. NWS forecast</p>
      </header>

      {loading && (
        <p className="text-gray-500 animate-pulse">Loading data...</p>
      )}

      {fetchError && (
        <p className="text-red-600 bg-red-50 px-4 py-3 rounded">
          Failed to load: {fetchError}
        </p>
      )}

      {data?.errors && (
        <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded px-4 py-3 text-sm text-yellow-800">
          {Object.entries(data.errors).map(([src, msg]) => (
            <p key={src}><span className="font-semibold">{src}:</span> {msg}</p>
          ))}
        </div>
      )}

      {!loading && data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {/* Gap indicator */}
          <div className="md:col-span-3 bg-white rounded-lg border p-4 flex items-center gap-6">
            <div className="text-center">
              <p className="text-xs text-gray-400 uppercase tracking-wide">NWS Forecast</p>
              <p className="text-3xl font-bold text-blue-600">
                {noaaTemp !== null ? `${noaaTemp}°F` : "—"}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {data.noaaHighTempType ?? "—"}{data.kalshiMarketDate ? ` · ${data.kalshiMarketDate}` : ""}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Kalshi Implied</p>
              <p className="text-3xl font-bold text-purple-600">
                {impliedTemp !== null ? `${impliedTemp.toFixed(1)}°F` : "—"}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {data.kalshiMarketDate ?? "—"}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Gap</p>
              <p className={`text-3xl font-bold ${gap === null ? "text-gray-400" : Math.abs(gap) >= 3 ? "text-red-500" : "text-green-600"}`}>
                {gap !== null ? `${gap > 0 ? "+" : ""}${gap.toFixed(1)}°F` : "—"}
              </p>
              {gap !== null && (
                <p className="text-xs text-gray-400 mt-1">
                  {Math.abs(gap) < 1 ? "markets agree" : Math.abs(gap) < 3 ? "slight divergence" : "notable divergence"}
                </p>
              )}
            </div>
            <div className="ml-auto text-right text-xs text-gray-400">
              <p>{data.forecastDate}</p>
              <p>fetched {new Date(data.fetchedAt).toLocaleTimeString()}</p>
            </div>
          </div>

          {/* NOAA forecast */}
          <div className="bg-white rounded-lg border p-4">
            <h2 className="font-semibold text-gray-700 mb-1">NWS Forecast</h2>
            <p className="text-xs text-gray-400 mb-3">24hr max for: <span className="font-medium">{data.kalshiMarketDate ?? "—"}</span></p>
            {data.noaaForecast ? (() => {
              // Show hourly periods for the Kalshi resolution date only, every 3 hours to keep display concise
              const dayPeriods = data.kalshiMarketDate
                ? data.noaaForecast.periods.filter((p: ForecastPeriod) =>
                    new Date(p.startTime).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) === data.kalshiMarketDate
                  ).filter((_: ForecastPeriod, i: number) => i % 3 === 0)
                : data.noaaForecast.periods.slice(0, 8);
              return (
                <ul className="space-y-2">
                  {dayPeriods.map((p: ForecastPeriod) => (
                    <li key={p.number} className="flex justify-between text-sm">
                      <span className="text-gray-600 w-20 shrink-0">
                        {new Date(p.startTime).toLocaleTimeString("en-US", { hour: "numeric", hour12: true, timeZone: "America/New_York" })}
                      </span>
                      <span className="font-medium">{p.temperature}°{p.temperatureUnit}</span>
                      <span className="text-gray-400 text-right truncate ml-2 max-w-36">{p.shortForecast}</span>
                    </li>
                  ))}
                </ul>
              );
            })() : (
              <p className="text-sm text-gray-400">Unavailable</p>
            )}
          </div>

          {/* Kalshi markets */}
          <div className="md:col-span-2 bg-white rounded-lg border p-4">
            <h2 className="font-semibold text-gray-700 mb-1">Kalshi Markets — KXHIGHNY</h2>
            <p className="text-xs text-gray-400 mb-3">Resolving for: <span className="font-medium">{data.kalshiMarketDate ?? "—"}</span></p>
            {data.kalshiMarkets.length > 0 ? (
              <div className="space-y-2">
                {data.kalshiMarkets.map((m) => {
                  const bid = m.yesBidDollars;
                  const ask = m.yesAskDollars;
                  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : bid || ask;
                  const pct = Math.round(mid * 100);
                  return (
                    <div key={m.ticker} className="flex items-center gap-3 text-sm">
                      <span className="text-gray-600 w-44 shrink-0 truncate">{m.subtitle || m.title}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div
                          className="bg-purple-400 h-2 rounded-full"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      <span className="w-10 text-right font-medium text-gray-700">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Unavailable</p>
            )}
          </div>

        </div>
      )}

      <footer className="mt-8 text-center text-xs text-gray-400">
        Built by Harbly &bull; Data from Kalshi and NOAA
      </footer>
    </div>
  );
}
