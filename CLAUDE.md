# Project: Forecast Gap Dashboard

## Overview
A public dashboard comparing prediction market odds (Polymarket, Kalshi)
against real-world forecasts (NOAA weather) to highlight gaps and track
historical accuracy.

## Tech Stack
- Next.js 14+ (App Router) with TypeScript
- Tailwind CSS + shadcn/ui for styling
- Supabase (PostgreSQL) for database
- Vercel for hosting + cron jobs
- Recharts for data visualization

## Data Sources
- Polymarket Gamma API (public, no auth for reads)
- Kalshi Trade API v2 (public endpoints, no auth for market data)
- NOAA/NWS API (free, no auth required)

## Project Structure
- /src/app — Next.js app router pages
- /src/app/api — API routes (backend)
- /src/lib — Shared utilities, API clients, database queries
- /src/components — React UI components
- /scripts — Data pipeline scripts (fetchers, matchers, scorers)

## Conventions
- Use TypeScript for all files
- Use async/await for all API calls
- Store API responses in Supabase; never rely on live API calls for the UI
- All components should be responsive (mobile-first)
- Use shadcn/ui components where possible for consistent design

## API Notes

### NOAA/NWS API
- **Use Central Park coordinates: `40.7829, -73.9654`** — Kalshi KXHIGHNY resolves against Central Park. Do NOT use 40.7128, -74.006 (that resolves to Hoboken, NJ grid)
- **Two-step process required:**
  1. Call `/points/{lat},{lon}` to get a grid metadata response
  2. Extract `properties.forecast` URL from that response, then call it for the actual forecast
- **Key fields in forecast response:** `properties.periods[]` — each period has `name`, `temperature`, `temperatureUnit`, `shortForecast`, `probabilityOfPrecipitation.value`
- **User-Agent header is required** — requests without it return a 403. Set to `"ForecastGapDashboard/1.0"` (handled globally in `src/lib/api-client.ts`)
- **Flakiness:** The API is occasionally slow or returns 500 errors. Treat failures as transient and retry. Do not rely on it for real-time UI rendering — always read from Supabase instead.
- Sample response saved at `scripts/sample-data/noaa-forecast-sample.json`

### Kalshi
- Actual field names differ slightly from docs
- `yes_bid_dollars` = decimal probability (e.g., 0.99 = 99%) — **returned as a string**, must `parseFloat()` before math
- `volume_fp` = trading volume (fixed-point format)
- `event_ticker` (not `series_ticker`) is the grouping field on market objects
- **`status` mismatch:** query param uses `status=open` but returned objects have `status: "active"` — filter client-side with `status === "active"`, not `"open"`
- **Do not keyword-filter market titles** — parlay titles contain false positives (e.g., "CAR Hurricanes" = NHL team)
- **Use `/series` endpoint to discover weather series** — returns all 9,233 series in one page, filter by `title` or `category === "Climate and Weather"`
- Key NYC series: `KXHIGHNY` (daily high), `KXLOWNY` (daily low), `KXRAINNYC` (daily rain), `KXSNOWNYC` (snow)
- Sample weather series saved at `scripts/sample-data/kalshi-weather-series.json`

### Polymarket
- Use `/events?tag_slug=temperature` (NOT `/markets` or `tag_slug=weather`)
- NYC daily weather series: `seriesSlug` = `"nyc-daily-weather"`
- `outcomePrices` is a JSON string — must be parsed with `JSON.parse()`
- Resolves via Weather Underground (KLGA), NOT NOAA
- Kalshi resolves via Central Park — different station, may differ by a few degrees
- Sample response saved at `scripts/sample-data/polymarket-markets-sample.json`

## Available Weather Series

### How to discover series
- **Kalshi:** `GET /trade-api/v2/series` — returns all 9,233 series in a single page. Filter client-side by `category === "Climate and Weather"` (299 results). Sample saved at `scripts/sample-data/kalshi-weather-series.json`.
- **Polymarket:** `GET /events?tag_slug=temperature&closed=false` — returns daily city-level temperature bracket markets. NYC series: `seriesSlug = "nyc-daily-weather"`.

---

### Kalshi — Daily Temperature Series
| Ticker | Title | City |
|---|---|---|
| KXHIGHNY | Highest temperature in NYC | New York City |
| HIGHNY | Highest temperature in NYC | New York City |
| KXLOWNYC / KXLOWTNYC / KXLOWNY | Lowest temperature in NYC | New York City |
| KXHIGHCHI / HIGHCHI | Highest temperature in Chicago | Chicago |
| KXLOWCHI / KXLOWTCHI | Lowest temperature in Chicago | Chicago |
| KXHIGHTBOS | Boston Maximum Daily Temperature | Boston |
| KXHIGHLAX / KXLOWLAX / KXLOWTLAX | High/Low temperature in Los Angeles | Los Angeles |
| KXHIGHMIA / HIGHMIA / KXLOWMIA / KXLOWTMIA | High/Low temperature in Miami | Miami |
| KXHIGHOU / KXHIGHTHOU / KXHOUHIGH | Highest temperature in Houston | Houston |
| KXHIGHDEN / KXDENHIGH / KXLOWTDEN / KXLOWDEN | High/Low temperature in Denver | Denver |
| KXHIGHPHIL / KXLOWTPHIL / KXLOWPHIL | High/Low temperature in Philadelphia | Philadelphia |
| KXHIGHTSATX | San Antonio Daily Maximum Temperature | San Antonio |
| KXHIGHTATL | Atlanta Max Temperature | Atlanta |
| KXHIGHTDC | Washington DC Daily Max Temp | Washington DC |
| KXHIGHTDAL | Dallas Maximum Temperature | Dallas |
| KXHIGHTOKC | Oklahoma City Maximum High Temperature | Oklahoma City |
| KXHIGHTPHX | Phoenix High Temperature Daily | Phoenix |
| KXHIGHTLV | Las Vegas Max Daily Temperature | Las Vegas |
| KXHIGHTMIN | Minneapolis Daily High Temperature | Minneapolis |
| KXHIGHTSEA / KXRAINSEA / RAINSEA | Seattle Max Temp / Rain | Seattle |
| KXHIGHTSFO | San Francisco High Temperature Daily | San Francisco |
| KXHIGHTNOLA | New Orleans Max temp Daily | New Orleans |
| KXHIGHAUS / HIGHAUS / KXLOWAUS / KXLOWTAUS | High/Low temperature in Austin | Austin |
| KXDVHIGH | Death Valley temperature | Death Valley |
| KXHIGHUS / HIGHUS | High temp in United States | National |
| KXCITIESWEATHER | Highest temperature in cities | Multi-city |
| RAINNYC / KXRAINNYC | NYC rain | New York City |

### Kalshi — Monthly Series
| Ticker | Title |
|---|---|
| KXSNOWNYM / SNOWNYM / KXNYCSNOWM | NYC snowfall |
| RAINNYCM / KXRAINNYCM | Monthly rain in New York |
| KXMINNYC / MINNYC | Min NYC temp |
| KXCHISNOWM | Chicago snowfall |
| KXBOSSNOWM | Boston snow |
| KXDALSNOWM | Dallas snowfall |
| KXDENSNOWM / KXDENSNOWMB | Denver snowfall |
| KXHOUSNOWM | Houston snowfall |
| KXPHILSNOWM | Philadelphia snow |
| KXDCSNOWM | DC snow |
| KXTORNADO / TORNADO | Number of Tornadoes |
| KXTEMPMON / TEMPMON | Global monthly temperature average |
| KXAVGTEMP / AVGTEMP | US average temp |
| KXCO2 / CO2 | US CO2 totals |
| KXMEAD / MEAD | Lake Mead water levels |

### Kalshi — Annual Series
| Ticker | Title |
|---|---|
| KXHURCTOT / HURCTOT | Number of hurricanes |
| KXHURCTOTMAJ / HURCTOTMAJ | Number of major hurricanes |
| KXTROPSTORM / TROPSTORM | Number of tropical storms |
| KXHOTYEAR / HOTYEAR / KXGTEMP / GTEMP | Hottest year ever / Global heat |
| KXTEMP / TEMP | Average annual temperature deviation |
| KXFEMA / FEMA | States that declare natural disasters |
| KXCORIVER / CORIVER | Lake Mead water level projections |

> There are also ~140 custom/one-off series (hurricanes hitting specific cities, snowstorms, earthquakes, etc.) not listed here. See `scripts/sample-data/kalshi-weather-series.json` for the full list.

---

### Polymarket — NYC Daily Temperature
| Series Slug | Title | Resolution Source |
|---|---|---|
| `nyc-daily-weather` | Highest temperature in NYC on [date] | Weather Underground / KLGA |

- Fetched via `/events?tag_slug=temperature&closed=false` — filter to NYC using `tags[].slug === "new-york-city"`
- Each event has 11 bracket sub-markets (e.g. 64–65°F), nested under `event.markets[]`
- `outcomePrices` is a JSON string — parse with `JSON.parse()` to get `[yesPrice, noPrice]`
- Resolves via **Weather Underground (KLGA)** — Kalshi resolves via **Central Park**, may differ by a few degrees

## Current Status
- Phase: Phase 0 — Foundations
- Last completed: Project scaffolded and deployed to Vercel
- Currently working on: Learning fundamentals
- Next milestone: Phase 1 — Fetch data from all 3 APIs

## Matching Logic

### Core Approach
Compare prediction market implied distributions against NWS forecast
distributions for the same city and date. Two separate comparisons:
Kalshi vs NWS and Polymarket vs NWS (not all three on one chart —
bucket structures differ between platforms).

### Implied Temperature Calculation
To extract a point estimate from bucket markets:
1. Pull prices for all buckets in an event (use bid/ask midpoint
   when both sides have size, fall back to last_price when book
   is thin)
2. Normalize probabilities to sum to 1 (raw prices typically sum
   to 101-109% due to overround)
3. Assign midpoints to each bucket (use range center for bounded
   buckets, judgment call for open-ended tails — e.g., 2-3°F
   beyond the boundary)
4. Compute probability-weighted average: E[Temp] = Σ(prob × midpoint)

### Tail Bucket Problem
When a tail bucket holds >40-50% of probability, the implied temp
is dominated by the tail midpoint assumption and becomes unreliable.
Dashboard should flag these cases and show a range instead of a
point estimate.

### NWS Forecast Endpoint — Use Hourly, Not 12-Hour Periods
Kalshi "highest temperature" markets resolve against the Central Park
NWS Climatological Report, which records the **highest temperature
observed in the full calendar day (midnight–midnight ET)**. This can
occur overnight, not just during the daytime period.

- **Do NOT use the regular `/forecast` endpoint** (12-hour periods like
  "Friday" / "Friday Night") — these only capture the daytime high and
  will miss overnight peaks.
- **Use `/forecast/hourly`** — 1-hour periods, covering the full 24-hour
  day. Filter all periods whose `startTime` (in ET) falls on the
  resolution date, then take `Math.max()` across all temperatures.
- This is implemented in `noaa-client.ts` as `getForecastHourly()` and
  the route computes `noaaHighTemp` as the 24-hour calendar-day max,
  labeled `noaaHighTempType: "24hr max"` in the response.

Example: March 27 daytime period showed 53°F, but the true 24hr hourly
max was 62°F (at 1–2am overnight carryover from March 26).

### NWS Distribution Modeling
NWS point forecasts are not certainties. For 1-day forecasts,
errors are roughly normally distributed with σ ≈ 3°F and slight
warm bias in winter. Model NWS as normal distribution centered on
the point forecast.

Better approach (future): Pull NDFD probabilistic forecasts
(10th/25th/50th/75th/90th percentile temps) from NWS API to get
official uncertainty bands instead of assuming σ.

### Resolution Sources (Important)
- Kalshi resolves against Central Park observations
- Polymarket resolves against Weather Underground (KLGA/LaGuardia)
- These are different stations and can report different temperatures
- Accuracy scoring must track which ground truth source each
  market uses

### Dashboard Visualization Plan
- Two panels per city/date: Kalshi vs NWS (left), Polymarket vs NWS (right)
- Each panel shows bar chart of market bucket distribution overlaid
  with NWS normal curve mapped to those same buckets
- Summary card showing: Polymarket implied temp | Kalshi implied temp |
  NWS forecast
- Use each platform's native bucket structure — do not interpolate
  onto a common axis
- Some city/date combos may only exist on one platform — that's fine,
  show whichever is available

### Generalized Bucket-to-Estimate Logic
The same math works for any bucket market (temperature, rain inches,
snowfall). Build the function once:
1. Parse strike types (less than, between, greater than) to determine ranges
2. Assign midpoints with configurable tail assumptions
3. Pull and normalize prices
4. Compute weighted average
Apply to any Kalshi or Polymarket series.

### Theoretical Value Proposition
The dashboard is a calibration tool for prediction markets. Over time
it answers: "How well-calibrated are prediction markets on weather,
and in what conditions do they diverge from expert forecasts?"

Three angles:
1. Bias discovery — do markets systematically over/underestimate in
   certain weather regimes (cold fronts, high uncertainty days)?
2. Market efficiency — how fast do markets incorporate new NWS forecast
   updates vs. official revisions?
3. Wisdom of crowds test — can markets match or beat one of the most
   sophisticated forecasting operations on earth?

### What Makes a Good Market for the Dashboard
- Probability spread across 4+ buckets (interesting distribution)
- No single bucket holding >50% (otherwise point estimate is unreliable)
- Decent volume/liquidity (bid-ask spreads are tight enough for
  meaningful prices)
- High-uncertainty weather regimes produce the most interesting gaps

## Progress Log

### 2026-03-05
- Installed Node.js, Git, VS Code. All verified working.
- Created GitHub repo: forecast-gap-dashboard

### 2026-03-07
- Scaffolded Next.js project with TypeScript + Tailwind
- Deployed to Vercel — live at https://forecast-gap-dashboard.vercel.app
- Created CLAUDE.md

### 2026-03-12
- Explored all 3 APIs in the browser
- Kalshi KXHIGHNY series returns daily NYC temp markets — perfect first match
- NOAA forecast returns 7-day hourly temps — will need to extract the relevant day

### 2026-03-26
- Built out all three API clients (noaa-client.ts, kalshi-client.ts, polymarket-client.ts) with retry logic
- Created /api/weather-comparison route + dashboard homepage UI
- Fixed several Kalshi API quirks: price fields are strings, status is "active" not "open", date must be parsed from eventTicker not close_time
- Fixed NOAA coordinates: Central Park (40.7829, -73.9654) not downtown NYC (Hoboken grid)
- Switched NWS comparison to use hourly endpoint + 24hr calendar-day max to match Kalshi resolution logic
- Dashboard is live showing NWS 24hr max vs. Kalshi implied temp with gap indicator

### 2026-05-18
- Migrated project from Windows PC to Mac
- Reinstalled and verified all tools (Node.js, Git, VS Code)
- Ready to begin Phase 2

### 2026-05-19 (Days 39–42)
- Set up Supabase project, created all four tables via create-schema.sql
- Built and verified database.ts (typed insert/read functions)
- Built fetch-markets pipeline: 12 Kalshi KXHIGHNY snapshots inserted
- Built fetch-forecasts pipeline: NWS hourly 24hr max computed and inserted
- Built compute-comparisons pipeline: implied temp vs NWS gap computed (0.18°F agree)
- Extracted pipeline logic into src/lib/pipeline/ for reuse by cron routes
- Created three cron API routes with CRON_SECRET auth
- Created vercel.json with free-plan daily schedules
- Connected dashboard to database (fast path) with live API fallback

## Database Schema

### market_snapshots
Stores a snapshot of each prediction market every time the pipeline fetches.
One row per market per fetch cycle. Never updated — only inserted.

Fields:
- id: uuid, primary key, auto-generated
- source: text — 'kalshi' or 'polymarket'
- series_ticker: text — e.g. 'KXHIGHNY'
- event_ticker: text — e.g. 'KXHIGHNY-26MAY19'
- market_ticker: text — e.g. 'KXHIGHNY-26MAY19-T95'
- resolution_date: date — the date this market resolves
- city: text — e.g. 'nyc'
- threshold: numeric — the temperature threshold (e.g. 95)
- strike_type: text — 'greater', 'less', or 'between'
- cap_strike: numeric — upper bound for 'between' markets, null otherwise
- yes_bid: numeric — current implied probability (0 to 1)
- volume: numeric — trading volume (used to filter thin markets)
- fetched_at: timestamptz — when this snapshot was taken
- created_at: timestamptz — auto-set

### market_snapshots field gotcha: "less" markets
For strike_type = 'less' (lower tail bucket), the meaningful temperature
value is cap_strike, not threshold. Threshold will be 0 for these markets.
Example: "will it be below 77°F" → threshold=0, cap_strike=77.

The matching engine (compute-comparisons) must handle this:
- 'greater' markets: use threshold as the lower bound
- 'less' markets: use cap_strike as the upper bound
- 'between' markets: use threshold as lower, cap_strike as upper

Midpoint calculation:
- 'greater': threshold + 3 (open upper tail assumption)
- 'less': cap_strike - 3 (open lower tail assumption)
- 'between': (threshold + cap_strike) / 2

### forecasts
Stores NWS forecast data for a city and date at the time of fetch.
One row per city per forecast_date per fetch cycle. Never updated — only inserted.

Fields:
- id: uuid, primary key, auto-generated
- city: text — e.g. 'nyc'
- forecast_date: date — the date being forecast
- max_temp_24h: numeric — TRUE 24hr high across all hourly periods (PRIMARY comparison field vs Kalshi)
- daytime_high: numeric — highest temp 6am-8pm (context only)
- low_temp: numeric — overnight low
- precip_prob: numeric — probability of precipitation (%)
- short_forecast: text — e.g. 'Mostly Sunny'
- source: text — 'nws'
- fetched_at: timestamptz
- created_at: timestamptz

### comparisons
Derived table — output of the matching engine. Links a market snapshot
to a forecast and stores the computed gap. This is what the dashboard reads.
Never recomputed in place — re-run compute-comparisons to regenerate.

Fields:
- id: uuid, primary key, auto-generated
- market_snapshot_id: uuid, foreign key to market_snapshots(id)
- forecast_id: uuid, foreign key to forecasts(id)
- city: text
- comparison_date: date
- source: text — 'kalshi' or 'polymarket'
- series_ticker: text
- implied_temp: numeric — weighted average from market bucket probabilities
- nws_temp: numeric — max_temp_24h from forecast row
- gap: numeric — implied_temp minus nws_temp (positive = market warmer)
- gap_direction: text — 'market_warmer', 'nws_warmer', or 'agree' (<1F gap)
- fetched_at: timestamptz
- created_at: timestamptz

### accuracy_scores
Filled in after events resolve. Records actual observed temperature and
scores who was closer — market or NWS. Gets richer over time.

Fields:
- id: uuid, primary key, auto-generated
- comparison_id: uuid, foreign key to comparisons(id)
- city: text
- resolution_date: date
- actual_temp: numeric — observed temperature (ground truth)
- actual_source: text — 'nws_climatological' (for Kalshi) or 'weather_underground_klga' (for Polymarket)
- market_implied_temp: numeric — copied from comparison row
- nws_forecast_temp: numeric — copied from comparison row
- market_error: numeric — abs(actual_temp - market_implied_temp)
- nws_error: numeric — abs(actual_temp - nws_forecast_temp)
- winner: text — 'market', 'nws', or 'tie'
- horizon_hours: integer — 24 for MVP; future support for 48, 12, 6, null for time-weighted
- scored_at: timestamptz
- created_at: timestamptz

## Accuracy Scoring Methodology

**Core principle:** Score markets at a fixed time horizon before close,
not at close. Markets converge to the correct answer as close approaches
so scoring at close is meaningless.

**MVP methodology:** Use the market snapshot closest to 24 hours before
the market's close_time. This represents a genuine prediction made with
real uncertainty remaining.

**Future horizons:** The architecture supports adding 48hr, 24hr, 12hr,
and 6hr scoring in the future, plus a time-weighted average across all
snapshots. No schema changes needed — all raw snapshots are stored in
market_snapshots with fetched_at timestamps.

**Schema note:** accuracy_scores includes a horizon_hours field (integer)
to distinguish between scoring methodologies:
- 24 = MVP default (snapshot closest to 24hrs before close)
- 48, 12, 6 = future horizons
- null = time-weighted average (future)

**Resolution sources:**
- Kalshi: score against NWS Climatological (Central Park)
- Polymarket: score against Weather Underground KLGA (LaGuardia)
Track which source was used in the actual_source field.

## Pipeline Design Notes

### Date range handling
The pipeline is agnostic to how many days ahead each source covers.
fetch-forecasts should not hardcode a fixed number of days. Instead:
1. fetch-markets runs first and pulls all open Kalshi/Polymarket markets
2. fetch-forecasts reads the distinct resolution_dates from the most recent
   market_snapshots and fetches NWS forecasts for exactly those dates
3. compute-comparisons joins them on city + date

This keeps sources in sync automatically regardless of how far ahead
Kalshi opens contracts or how far NWS forecasts extend.

### Cron Schedule (Current vs Target)
Current (free Vercel plan): once daily
- fetch-markets: 6am UTC
- fetch-forecasts: 6:30am UTC
- compute-comparisons: 7am UTC

Target (Vercel Pro, before public launch):
- fetch-markets: every hour (0 * * * *)
- fetch-forecasts: twice daily 6am + 6pm UTC (0 6,18 * * *)
- compute-comparisons: 10 minutes after fetch-markets (10 * * * *)

Upgrade to Vercel Pro when moving to Phase 3 public launch.

## UI Improvements Backlog

- Filter out Kalshi markets where probability is 99%+ or 1% or less (not interesting, clutters view)
- Sort Kalshi markets by temperature threshold in logical order (highest to lowest)
