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

## Current Status
- Phase: Phase 0 — Foundations
- Last completed: Project scaffolded and deployed to Vercel
- Currently working on: Learning fundamentals
- Next milestone: Phase 1 — Fetch data from all 3 APIs

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
