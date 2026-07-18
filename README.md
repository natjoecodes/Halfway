# Halfway

A fair meeting-place planner for couples, friends, and teams. Halfway compares
multimodal travel time, walking, transfers, budget, venue fit, and return-trip
feasibility to recommend places that divide the effort fairly.

Halfway now has a React client and a Node API. When Google Maps is configured,
the API discovers current Kochi venues, geocodes typed origins, requests public
transport routes for both travellers, and checks return-route feasibility. If
Google is unavailable, the app automatically uses the curated Kochi dataset.

## Google Maps setup

Enable these APIs in one Google Cloud project:

- Places API (New)
- Routes API
- Geocoding API
- Maps JavaScript API (only needed for browser autocomplete)

Create `.env` in the project root:

```bash
GOOGLE_MAPS_API_KEY=your_server_key
VITE_GOOGLE_MAPS_API_KEY=your_browser_key
API_PORT=8787
```

Keep the server key restricted to Places, Routes, and Geocoding APIs. Restrict
the browser key to your localhost and deployed website origins.

## Getting Started

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173` in your browser.

## Scripts

- `npm run dev` starts the React client and Node API together.
- `npm run dev:web` starts only the React client.
- `npm run start:api` starts only the production-style API process.
- `npm run build` creates a production build in `dist/`.
- `npm run preview` serves the production build locally.
- `npm run lint` checks the project with ESLint.

## Project Structure

```text
.
├── public/
├── src/
│   ├── App.css
│   ├── App.jsx
│   ├── data/
│   │   └── venues.js
│   └── main.jsx
├── server/
│   └── index.js
├── .env.example
├── .gitignore
├── eslint.config.js
├── index.html
├── package.json
└── README.md
```
