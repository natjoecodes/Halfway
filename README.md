# Halfway

Halfway is a Kochi-focused fair meeting-place planner. It compares both
travellers' time, fare, walking, transfers, budgets, venue hours, preferences,
and return feasibility instead of choosing a simple geographic midpoint.

## Data honesty

Halfway deliberately distinguishes official data from modelled values:

- Exact origins come from browser GPS, a selected Kochi landmark, or a
  user-triggered OpenStreetMap Nominatim lookup.
- Metro stops and fares come from KMRL's latest published GTFS archive. The
  archive declares validity through 2025-12-31, so current service frequency is
  taken from KMRL's timetable effective 2026-02-17 and is labelled modelled.
- Water Metro boat times, fares, and departures come from the official Kochi
  Water Metro website and schedule endpoint.
- Bus and walking access legs are planning estimates because a current,
  complete open Kochi bus GTFS feed is not available in this project.
- Venue prices are budget guides from the curated demo dataset, not live menu
  prices. The interface labels them accordingly.

No paid API key is required. Never present modelled values as live departures.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

```bash
npm test
npm run lint
npm run build
```

## Architecture

- React 19 + Vite frontend
- Node.js + Express API
- OpenStreetMap/Nominatim geocoding with disk caching and rate limiting
- Official KMRL GTFS stored at `data/otp/kochi-metro.gtfs.zip`
- Official Kochi Water Metro schedule integration
- Deterministic fairness and constraint scoring in `server/planner.js`
- Curated Kochi venues in `src/data/venues.js`

## Attribution

Contains data provided by Kochi Metro Rail Limited.

Map and geocoding data © OpenStreetMap contributors, available under the ODbL.
Water Metro information is retrieved from the official Kochi Water Metro site.

This project is not endorsed by KMRL, Kochi Water Metro, or OpenStreetMap.
