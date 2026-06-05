# Phase 3 Plan — Frontend, Accuracy Scoring, and Real-Time Markets

**Project:** Forecast Gap Dashboard
**Phase start:** June 2026
**Estimated duration:** 5–6 weeks
**Prerequisite:** Phase 2 complete. Pipeline running daily. Data accumulating since 5/19.

---

## What Phase 3 Delivers

By the end of Phase 3, a visitor hits the dashboard and sees:

1. **Real-time Kalshi market odds** for NYC daily high temperature — fetched live on every page load, not from stale snapshots
2. **NWS forecast** for the same dates, pulled from Supabase (refreshed daily by cron; forecasts don't move fast enough to warrant live fetch)
3. **The gap** between them — clear, visual, immediate
4. **Distribution charts** — Kalshi bucket probabilities as a bar chart, NWS modeled as a normal curve overlaid on the same axis
5. **Historical accuracy** — after markets resolve, who was closer? Running scoreboard with market error vs. NWS error
6. **City filtering** — scoped to NYC for launch, but built so adding Chicago, Miami, etc. is just config

This is the point where the project stops being a data pipeline and becomes a product someone would actually use.

---

## Architecture Decisions

### Real-Time Kalshi Odds
- The dashboard calls a Next.js API route (e.g., `/api/markets/live`) on page load
- That route fetches fresh Kalshi market data for active KXHIGHNY events
- If Kalshi is down or slow (>3s timeout), fall back to the most recent `market_snapshots` row in Supabase
- The API route does NOT write to Supabase — the daily cron handles storage. This keeps the live path fast and side-effect-free
- Display a subtle "Live" indicator when showing real-time data, "As of [time]" when showing fallback

### NWS Forecasts — Supabase Only
- NWS updates every 6–12 hours. The daily cron captures this adequately
- Frontend reads from `forecasts` table via API route
- No live NWS fetch from the frontend

### Gap Calculation
- Computed client-side from the live Kalshi implied temp and the stored NWS temp
- This means the gap shown on the dashboard may differ slightly from what's in the `comparisons` table (which was computed at cron time)
- That's correct behavior — the live gap IS different from the stored gap because the market has moved since the cron ran

### Accuracy Scoring
- New pipeline script + cron route, same pattern as existing pipelines
- Runs daily after markets resolve
- Reads from `market_snapshots` and `forecasts`, writes to `accuracy_scores`
- No live computation — purely batch

---

## Phase 3A — Accuracy Scoring Pipeline (~1 week)

Build this first. It runs in the background populating `accuracy_scores` while you build the frontend. By the time you're building the accuracy charts, you'll have real scored data to display.

### Tasks

**1. Build the actual-temperature fetcher**

Kalshi KXHIGHNY contracts resolve against the NWS Daily Climate Report (CLI) for Central Park. The resolution source is explicit in the contract rules: "The daily temperature high in New York City as reported by the National Weather Service in the Climatological Report (Daily)... based on reporting from New York City, Central Park, NY (NYC)."

The NWS observations API gives us this data programmatically:
- **Endpoint:** `https://api.weather.gov/stations/KNYC/observations`
- **Station:** KNYC = Central Park, the exact station Kalshi uses
- **What to pull:** `maxTemperature` from the daily observations
- **Timing:** The final CLI report is issued around 1:30 AM ET the following day, covering midnight-to-midnight. The scoring cron should run after this (e.g., 8 AM UTC / 3-4 AM ET) to ensure the full-day observation is available.
- **Same User-Agent requirement** as existing NWS calls (`ForecastGapDashboard/1.0`)

**Validation step (do this before writing the scoring script):**
Pick 3-4 dates from your `comparisons` table. Pull the observation from the KNYC endpoint for those dates. Cross-check the max temp against the published CLI report at `https://forecast.weather.gov/product.php?site=OKX&product=CLI&issuedby=NYC`. They should match exactly. If they don't, investigate before proceeding.

**2. Build the scoring script (`src/lib/pipeline/score-accuracy.ts`)**

Logic:
- Query `comparisons` for rows where `comparison_date` < today (resolved markets)
- Skip any that already have a matching row in `accuracy_scores` (idempotent)
- For each resolved date/city/source combo:
  - Fetch the actual observed max temp from `KNYC` observations for that date
  - Find the `market_snapshots` row closest to 24 hours before market close (the 24hr-horizon snapshot)
  - Compute: `market_error = abs(actual_temp - implied_temp)`, `nws_error = abs(actual_temp - nws_temp)`
  - Determine `winner`: 'market', 'nws', or 'tie' (if errors within 0.5°F)
  - Set `actual_source` = 'nws_climatological' (per existing schema)
  - Insert into `accuracy_scores`

**3. Create cron route (`src/app/api/cron/score-accuracy/route.ts`)**
- Same pattern as existing cron routes (CRON_SECRET auth, pipeline_logs)
- Schedule: 8 AM UTC (after your existing 6am/6:30am/7am chain, and after the 1:30 AM ET CLI report)
- Only scores dates that are fully resolved (comparison_date < today)

**4. Add to `vercel.json` cron schedule**
- Add the 8 AM UTC entry for score-accuracy

**5. Backfill existing data**
- Run the scoring script manually once against all resolved dates since 5/19
- This gives you ~2 weeks of accuracy data immediately

### Phase 3A Checkpoint
- Validated: KNYC observations endpoint returns the same max temp as the CLI report for at least 3 dates
- `accuracy_scores` table has rows for resolved dates since 5/19
- Scores look reasonable (market_error and nws_error both in the 0–10°F range, mostly small)
- Cron is scheduled and logging to `pipeline_logs`
- The winner column shows a plausible mix (not all one side)

---

## Phase 3B — Dashboard Frontend (~3–4 weeks)

### Design Direction

This is a data product, not a marketing site. The design should feel like a Bloomberg terminal crossed with a weather app — information-dense but not cluttered, with clear visual hierarchy. Think: dark or muted background, sharp accent colors for gap indicators, clean typography, charts that reward attention.

Avoid: generic SaaS dashboards with too much whitespace, pastel cards, and rounded corners on everything. This should feel like a tool for people who care about forecasting.

### Page Structure

**Single-page dashboard (MVP) with these sections:**

#### Section 1: Hero / Summary Cards
- Today's comparison at a glance
- Three numbers: **Kalshi Implied** | **NWS Forecast** | **Gap**
- Gap is color-coded: green (agree, <1°F), yellow (small, 1–3°F), red (notable, >3°F)
- "Live" badge on Kalshi number
- Date and city label

#### Section 2: Distribution Chart
- Primary visualization — the thing people come to look at
- **Kalshi bucket probabilities** as vertical bars (one bar per market bucket, e.g., 76–77°F, 77–78°F, etc.)
- **NWS forecast** as a normal curve overlay (centered on `max_temp_24h`, σ ≈ 3°F per CLAUDE.md)
- X-axis: temperature range. Y-axis: probability
- Tooltip on hover showing exact probabilities
- This chart should communicate instantly: "here's what the market thinks vs. what NWS thinks"

#### Section 3: Historical Accuracy
- Table or chart showing resolved dates
- Columns: Date | Kalshi Implied | NWS Forecast | Actual | Market Error | NWS Error | Winner
- Running win/loss record at the top: "Market: 8 | NWS: 6 | Tie: 2"
- Optional: line chart of errors over time

#### Section 4: Methodology / About (collapsible)
- Brief explanation of data sources, how implied temps are calculated, what "the gap" means
- Link to GitHub repo

### Components to Build

1. **`SummaryCard`** — displays a single metric (temp, gap) with label and optional badge
2. **`GapIndicator`** — color-coded gap display (reusable)
3. **`DistributionChart`** — Recharts bar + line combo chart for market buckets vs. NWS curve
4. **`AccuracyTable`** — historical results table with sorting
5. **`AccuracyScoreboard`** — win/loss/tie running totals
6. **`CityFilter`** — dropdown/tabs for city selection (NYC only at launch, but built for expansion)
7. **`DateNavigator`** — select which date's comparison to view (today, tomorrow, next few days)
8. **`LiveBadge`** — small indicator showing data freshness ("Live" vs. "As of 6:00 AM")
9. **`LoadingState`** — skeleton/spinner for async data
10. **`ErrorState`** — graceful fallback when data is unavailable

### API Routes to Build

1. **`/api/markets/live`** — fetches real-time Kalshi KXHIGHNY markets, computes implied temp, returns structured data. Falls back to latest Supabase snapshot on failure.
2. **`/api/forecasts/current`** — reads latest NWS forecast from Supabase for the requested city/dates.
3. **`/api/accuracy`** — reads from `accuracy_scores`, supports date range and city filters.
4. **`/api/comparisons/current`** — reads latest stored comparisons (for dates where we have both market and forecast data).

### Data Flow on Page Load

```
User hits dashboard
  → Frontend calls /api/markets/live
    → API route fetches Kalshi API in real-time
    → Parses bucket prices, computes implied temp
    → Returns: { buckets: [...], impliedTemp, source: 'live', fetchedAt }
    → (On failure: reads latest market_snapshots from Supabase, returns with source: 'cached')
  → Frontend calls /api/forecasts/current
    → Reads from Supabase forecasts table
    → Returns: { maxTemp24h, shortForecast, fetchedAt }
  → Frontend calls /api/accuracy
    → Reads from Supabase accuracy_scores
    → Returns: { scores: [...], summary: { marketWins, nwsWins, ties } }
  → Frontend computes live gap (impliedTemp - maxTemp24h)
  → Renders everything
```

### Responsive Design
- Mobile-first (per CLAUDE.md convention)
- Summary cards: stack vertically on mobile, row on desktop
- Distribution chart: full-width, scrollable on very narrow screens
- Accuracy table: horizontal scroll on mobile, or switch to card layout
- Test at 375px (iPhone SE), 390px (iPhone 14), 768px (iPad), 1280px (desktop)

### Phase 3B Checkpoint
- Dashboard loads and shows real-time Kalshi odds
- Distribution chart renders with market buckets and NWS overlay
- Historical accuracy table shows scored results
- Fallback works (kill Kalshi fetch temporarily, confirm Supabase fallback kicks in)
- Looks good on mobile and desktop

---

## Phase 3C — Polish and QA (~1 week)

### Tasks

1. **Loading states** — skeleton screens while data loads, not blank white page
2. **Error states** — if everything fails, show a meaningful message not a crash
3. **Empty states** — "No accuracy data yet" instead of an empty table
4. **Stale data handling** — if Supabase data is >48 hours old, show a warning
5. **Tail bucket warning** — per CLAUDE.md, flag when a single bucket holds >40–50% probability and the implied temp estimate is unreliable
6. **Basic accessibility** — semantic HTML, alt text on charts, keyboard navigation
7. **Performance** — confirm page load is under 3 seconds on mobile
8. **Cross-browser check** — Chrome, Safari, Firefox at minimum
9. **Update CLAUDE.md** — Phase 3 complete, document any new API quirks, update Current Status

### Phase 3C Checkpoint
- No visual jank or layout shifts
- Loading → data transition is smooth
- Works on your phone
- CLAUDE.md updated

---

## Sequencing Summary

| Step | What | Duration | Depends On |
|------|------|----------|------------|
| 3A.1 | Research actual temperature observation source | 1–2 days | Nothing |
| 3A.2 | Build scoring script | 2–3 days | 3A.1 |
| 3A.3 | Cron route + backfill | 1 day | 3A.2 |
| 3B.1 | API routes (live markets, forecasts, accuracy) | 2–3 days | 3A.3 (accuracy route needs scored data) |
| 3B.2 | Summary cards + gap indicator | 2 days | 3B.1 |
| 3B.3 | Distribution chart | 3–4 days | 3B.1 |
| 3B.4 | Historical accuracy table + scoreboard | 2–3 days | 3B.1 + 3A.3 |
| 3B.5 | City filter + date navigator | 1–2 days | 3B.2 |
| 3B.6 | Responsive pass | 2 days | 3B.2–3B.5 |
| 3C | Polish, QA, CLAUDE.md update | 3–5 days | 3B complete |

**Total: ~5–6 weeks**

---

## Decisions Deferred to Phase 4

- Custom domain
- SEO (meta tags, OpenGraph images)
- Vercel Analytics
- Vercel Pro upgrade (hourly crons)
- Polymarket panel (Kalshi only for Phase 3)
- About page as separate route
- Social sharing features

---

## What to Paste into Claude Code

When starting Phase 3 work in Claude Code, paste the relevant section above (3A, 3B, or 3C) along with your CLAUDE.md. Update CLAUDE.md's Current Status to:

```
## Current Status
- Phase: Phase 3A — Accuracy Scoring Pipeline
- Last completed: Phase 2 — Full data pipeline running on Vercel
- Currently working on: Building accuracy scoring script + actual temp observation source
- Next milestone: Phase 3B — Dashboard frontend with real-time Kalshi
```
