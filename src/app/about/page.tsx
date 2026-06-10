import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About & Methodology",
  description:
    "How the Forecast Gap Dashboard compares prediction market odds against NWS forecasts: data sources, implied temperature calculation, and accuracy scoring.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-lg font-semibold text-slate-100">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-slate-400">{children}</div>
    </section>
  );
}

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-[#0a0f1e] text-slate-100">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <header className="mb-10">
          <Link href="/" className="text-sm text-violet-400 hover:text-violet-300">
            ← Back to dashboard
          </Link>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            About &amp; Methodology
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            What this dashboard measures and how the numbers are computed.
          </p>
        </header>

        <Section title="What this is">
          <p>
            The Forecast Gap Dashboard is a calibration tool for prediction markets. It compares
            the temperature implied by prediction market prices (Kalshi) against the official
            National Weather Service forecast for the same day, then — once the day resolves —
            scores which one was closer to the observed temperature.
          </p>
          <p>
            Over time it answers a simple question: how well-calibrated are prediction markets on
            weather, and in what conditions do they diverge from expert forecasts?
          </p>
        </Section>

        <Section title="Data sources">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <span className="text-slate-200">Kalshi</span> — daily NYC high-temperature bucket
              markets (series <code className="text-violet-400">KXHIGHNY</code>), fetched hourly
              via the public Kalshi Trade API.
            </li>
            <li>
              <span className="text-slate-200">NWS / NOAA</span> — hourly forecast for Central
              Park from the National Weather Service API, fetched daily.
            </li>
            <li>
              <span className="text-slate-200">Ground truth</span> — the NWS Daily Climate Report
              (CLI) for Central Park station KNYC, the exact source Kalshi uses to resolve its
              contracts.
            </li>
          </ul>
          <p>
            All data is snapshotted into a database on a schedule; the dashboard reads from those
            snapshots (with a live Kalshi fetch on page load when available).
          </p>
        </Section>

        <Section title="Implied temperature">
          <p>
            Kalshi markets split the day&apos;s high temperature into buckets (e.g. 82–83°F). Each
            bucket&apos;s price is an implied probability. To turn the full set of buckets into a
            single point estimate:
          </p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>Pull prices for every bucket in the event.</li>
            <li>
              Normalize probabilities to sum to 1 — raw prices typically sum to slightly more than
              100% due to market overround.
            </li>
            <li>
              Assign a midpoint temperature to each bucket: the range center for bounded buckets,
              and roughly 3°F beyond the boundary for the open-ended tail buckets.
            </li>
            <li>
              Compute the probability-weighted average: E[Temp] = Σ (probability × midpoint).
            </li>
          </ol>
          <p>
            When a single tail bucket holds a large share of the probability, the point estimate is
            dominated by the tail-midpoint assumption and becomes unreliable — the dashboard flags
            those cases.
          </p>
        </Section>

        <Section title="The NWS comparison">
          <p>
            Kalshi&apos;s market resolves on the highest temperature observed in the full calendar
            day (midnight to midnight ET) — which can occur overnight, not just in the afternoon.
            To match that, the dashboard uses the NWS <em>hourly</em> forecast and takes the
            maximum across all 24 hours of the resolution date, not the daytime-period forecast.
          </p>
          <p>
            The <span className="text-slate-200">gap</span> shown on the dashboard is the market
            implied temperature minus the NWS 24-hour max forecast. Positive means the market is
            pricing a warmer day than NWS predicts.
          </p>
        </Section>

        <Section title="Accuracy scoring">
          <p>
            Markets converge to the correct answer as resolution approaches, so scoring a market at
            close time is meaningless. Instead, each day is scored at a fixed horizon: the market
            snapshot closest to 24 hours before resolution — a genuine prediction made with real
            uncertainty remaining. (The actual window is 22–25 hours; the scoreboard labels it
            &quot;24-hour horizon&quot; for simplicity.)
          </p>
          <p>
            After the NWS Climate Report publishes the observed high, both the market&apos;s implied
            temperature and the NWS forecast are scored by absolute error. Errors within 0.5°F of
            each other count as a tie.
          </p>
        </Section>

        <Section title="Resolution sources & caveats">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Kalshi resolves against <span className="text-slate-200">Central Park (KNYC)</span>{" "}
              observations via the NWS Daily Climate Report.
            </li>
            <li>
              Polymarket&apos;s NYC markets (planned addition) resolve against{" "}
              <span className="text-slate-200">Weather Underground at LaGuardia (KLGA)</span> — a
              different station that can read a few degrees differently. Accuracy scoring always
              tracks which ground truth each market uses.
            </li>
            <li>
              NWS point forecasts are not certainties — 1-day forecast errors are roughly normal
              with σ ≈ 3°F. The distribution chart models NWS as a normal curve on that basis.
            </li>
            <li>
              Late in the day, market prices increasingly reflect the temperature already observed
              rather than a forecast — the dashboard notes this after 5 PM ET.
            </li>
          </ul>
        </Section>

        <footer className="mt-12 border-t border-slate-800 pt-6 text-xs text-slate-600">
          Data: Kalshi · NWS/NOAA · Built as an open calibration experiment.
        </footer>
      </div>
    </div>
  );
}
