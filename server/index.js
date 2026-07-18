import 'dotenv/config'
import express from 'express'
import { venues as seededVenues } from '../src/data/venues.js'
import { planVenues, resolveLocalLocation, suggestLocalLocations } from './planner.js'
import { geocodeWithNominatim, reverseWithNominatim } from './nominatim.js'

const app = express()
const port = Number(process.env.API_PORT || 8787)
const cache = new Map()
const CACHE_TTL_MS = 10 * 60 * 1000

app.disable('x-powered-by')
app.use(express.json({ limit: '32kb' }))

function validCoordinates(value) {
  return Number.isFinite(value?.lat) && Number.isFinite(value?.lon ?? value?.lng)
}

async function resolveOrigin(text, coordinates) {
  if (validCoordinates(coordinates)) {
    return {
      name: coordinates.name || text || 'Pinned location', address: text,
      area: coordinates.area || 'Kochi', lat: Number(coordinates.lat),
      lon: Number(coordinates.lon ?? coordinates.lng), source: coordinates.source || 'Exact coordinates',
    }
  }
  const local = resolveLocalLocation(text)
  if (local) return { ...local, address: local.name }
  const osm = await geocodeWithNominatim(text)
  if (osm) return osm
  const error = new Error(`Could not locate “${text}” inside the Kochi planning area. Use GPS, drop a pin, or choose a listed place.`)
  error.status = 422
  throw error
}

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    routingModel: 'open-data',
    sources: {
      geocoding: 'OpenStreetMap Nominatim + local Kochi index',
      metro: 'KMRL GTFS (latest published archive) + current official timetable',
      waterMetro: 'Official Kochi Water Metro schedule endpoint',
      buses: 'Modelled; live GTFS unavailable',
    },
    cachedSearches: cache.size,
  })
})

app.get('/api/locations/suggest', (request, response) => {
  response.json({ suggestions: suggestLocalLocations(String(request.query.q || ''), 8), source: 'curated-open-data-index' })
})

app.get('/api/locations/reverse', async (request, response) => {
  const lat = Number(request.query.lat)
  const lon = Number(request.query.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    response.status(400).json({ error: 'Valid coordinates are required.' })
    return
  }
  try {
    response.json(await reverseWithNominatim(lat, lon))
  } catch {
    response.json({ name: 'Pinned location', address: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, area: 'Kochi', lat, lon, source: 'Exact coordinates' })
  }
})

app.post('/api/venues/search', async (request, response) => {
  const form = request.body || {}
  if (!form.location1?.trim() || !form.location2?.trim()) {
    response.status(400).json({ error: 'Both starting locations are required.' })
    return
  }
  const cacheKey = JSON.stringify({ ...form, person1: undefined, person2: undefined })
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    response.json({ ...cached.payload, cached: true })
    return
  }
  try {
    const origins = []
    origins.push(await resolveOrigin(form.location1, form.location1Coords))
    origins.push(await resolveOrigin(form.location2, form.location2Coords))
    const plan = planVenues(seededVenues, origins, form)
    const venues = plan.venues
    const payload = {
      source: 'open-data', venues, origins, candidateCount: seededVenues.length,
      warning: `${plan.relaxedConstraints ? 'Fewer than three places met every limit; alternatives are flagged. ' : ''}Metro and Water Metro legs use official sources. Walking and bus legs are modelled because a current citywide open GTFS feed is not published.`,
      provenance: {
        metro: { source: 'Kochi Metro Rail Limited', feedVersion: '1.0', feedValidThrough: '2025-12-31', currentTimetableEffective: '2026-02-17', url: 'https://kochimetro.org/open-data/' },
        waterMetro: { source: 'Kochi Water Metro', accessed: '2026-07-19', url: 'https://watermetro.co.in/boat-schedule' },
        maps: { source: 'OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
      },
      generatedAt: new Date().toISOString(),
    }
    cache.set(cacheKey, { createdAt: Date.now(), payload })
    response.json(payload)
  } catch (error) {
    response.status(error.status || 500).json({ error: error.message || 'Could not build a meeting plan.' })
  }
})

const server = app.listen(port, '127.0.0.1')
server.on('listening', () => console.log(`Halfway API listening on http://127.0.0.1:${port}`))
server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : `Halfway API failed: ${error.message}`)
  process.exitCode = 1
})
