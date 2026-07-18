import 'dotenv/config'
import express from 'express'
import { venues as seededVenues } from '../src/data/venues.js'

const app = express()
const port = Number(process.env.API_PORT || 8787)
const googleApiKey = process.env.GOOGLE_MAPS_API_KEY
const cache = new Map()
const CACHE_TTL_MS = 10 * 60 * 1000
const LIVE_VENUE_LIMIT = 15

app.disable('x-powered-by')
app.use(express.json({ limit: '32kb' }))

const purposeQueries = {
  'Romantic date': 'date cafes in Kochi Kerala',
  'Business meeting': 'business meeting cafes in Kochi Kerala',
  'Friends hanging out': 'cafes for groups in Kochi Kerala',
  'Casual catch-up': 'cafes in Kochi Kerala',
  'Work / study session': 'coworking cafes in Kochi Kerala',
}

const priceByLevel = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 300,
  PRICE_LEVEL_MODERATE: 700,
  PRICE_LEVEL_EXPENSIVE: 1400,
  PRICE_LEVEL_VERY_EXPENSIVE: 2200,
}

function validCoordinates(value) {
  return Number.isFinite(value?.lat) && Number.isFinite(value?.lng)
}

function haversine(a, b) {
  const toRadians = (value) => value * Math.PI / 180
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function midpoint(a, b) {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }
}

function durationSeconds(value = '0s') {
  return Number.parseFloat(value.replace('s', '')) || 0
}

function formatIndiaTime(date) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date)
}

function effectiveMeetingTime(date, time) {
  const requested = new Date(`${date}T${time}:00+05:30`)
  const earliest = new Date(Date.now() + 20 * 60 * 1000)
  return Number.isNaN(requested.getTime()) || requested < earliest
    ? new Date(Date.now() + 90 * 60 * 1000)
    : requested
}

async function googleFetch(url, options = {}, timeoutMs = 9000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const body = await response.json()
    if (!response.ok) {
      const message = body?.error?.message || body?.status || `Google request failed (${response.status})`
      throw new Error(message)
    }
    return body
  } finally {
    clearTimeout(timeout)
  }
}

async function geocode(address, coordinates) {
  if (validCoordinates(coordinates)) return coordinates
  if (!address?.trim()) throw new Error('Both starting locations are required')

  const params = new URLSearchParams({
    address: `${address.trim()}, Kochi, Kerala, India`,
    region: 'in',
    key: googleApiKey,
  })
  const body = await googleFetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`)
  if (body.status !== 'OK' || !body.results?.[0]) throw new Error(`Could not locate “${address}” in Kochi`)
  const location = body.results[0].geometry.location
  return { lat: location.lat, lng: location.lng }
}

async function searchPlaces(center, form) {
  const radius = Math.min(50000, Math.max(10000, haversine(form.origins[0], form.origins[1]) / 2 + 7000))
  const queries = [purposeQueries[form.purpose] || purposeQueries['Casual catch-up'], 'public attractions in Kochi Kerala']
  const fieldMask = [
    'places.id', 'places.displayName', 'places.formattedAddress', 'places.shortFormattedAddress',
    'places.location', 'places.primaryType', 'places.primaryTypeDisplayName', 'places.types',
    'places.rating', 'places.userRatingCount', 'places.priceLevel', 'places.regularOpeningHours',
    'places.googleMapsUri', 'places.businessStatus', 'places.accessibilityOptions',
    'places.outdoorSeating', 'places.reservable', 'places.servesCoffee',
  ].join(',')

  const responses = await Promise.all(queries.map((textQuery) => googleFetch(
    'https://places.googleapis.com/v1/places:searchText',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': googleApiKey,
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify({
        textQuery,
        pageSize: 20,
        regionCode: 'IN',
        languageCode: 'en',
        locationBias: {
          circle: {
            center: { latitude: center.lat, longitude: center.lng },
            radius,
          },
        },
      }),
    },
  )))

  const unique = new Map()
  for (const place of responses.flatMap((response) => response.places || [])) {
    if (place.businessStatus === 'CLOSED_PERMANENTLY' || !place.location || unique.has(place.id)) continue
    const distance = haversine(center, { lat: place.location.latitude, lng: place.location.longitude })
    if (distance <= radius * 1.35) unique.set(place.id, { ...place, distanceFromMidpoint: distance })
  }

  return [...unique.values()]
    .sort((a, b) => (b.rating || 0) * Math.log10((b.userRatingCount || 0) + 10) - (a.rating || 0) * Math.log10((a.userRatingCount || 0) + 10))
    .slice(0, LIVE_VENUE_LIMIT)
}

function routeStepText(step) {
  if (step.travelMode === 'WALK') {
    return step.navigationInstruction?.instructions || `Walk ${step.distanceMeters || 0} m`
  }
  const transit = step.transitDetails
  if (!transit) return step.navigationInstruction?.instructions || 'Continue by public transport'
  const vehicle = transit.transitLine?.vehicle?.name?.text || 'Transit'
  const line = transit.transitLine?.name ? ` ${transit.transitLine.name}` : ''
  const from = transit.stopDetails?.departureStop?.name
  const to = transit.stopDetails?.arrivalStop?.name
  return from && to ? `${vehicle}${line} from ${from} to ${to}` : `${vehicle}${line}`
}

function fallbackRoute(origin, destination, arrivalTime) {
  const distance = haversine(origin, destination)
  const minutes = Math.max(12, Math.round(distance / 360))
  const arrival = new Date(arrivalTime)
  const leave = new Date(arrival.getTime() - minutes * 60000)
  return {
    minutes,
    fare: Math.max(15, Math.round(distance / 1000 * 3)),
    walk: Math.min(1200, Math.max(250, Math.round(distance * .06))),
    transfers: distance > 9000 ? 2 : 1,
    wait: 7,
    confidence: 'Low',
    leave: formatIndiaTime(leave),
    returnBy: 'Not confirmed',
    steps: ['Transit estimate only; Google did not return detailed directions'],
  }
}

async function computeTransitRoute(origin, destination, arrivalTime) {
  try {
    const fieldMask = [
      'routes.duration', 'routes.distanceMeters', 'routes.travelAdvisory.transitFare',
      'routes.legs.steps.distanceMeters', 'routes.legs.steps.travelMode',
      'routes.legs.steps.navigationInstruction.instructions',
      'routes.legs.steps.transitDetails.stopDetails.departureStop.name',
      'routes.legs.steps.transitDetails.stopDetails.arrivalStop.name',
      'routes.legs.steps.transitDetails.transitLine.name',
      'routes.legs.steps.transitDetails.transitLine.vehicle.name',
    ].join(',')
    const body = await googleFetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': googleApiKey,
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
        travelMode: 'TRANSIT',
        arrivalTime,
        languageCode: 'en-IN',
        units: 'METRIC',
        transitPreferences: { allowedTravelModes: ['BUS', 'SUBWAY', 'TRAIN', 'LIGHT_RAIL', 'RAIL'] },
      }),
    })
    const route = body.routes?.[0]
    if (!route) return fallbackRoute(origin, destination, arrivalTime)

    const steps = route.legs?.flatMap((leg) => leg.steps || []) || []
    const walk = steps.filter((step) => step.travelMode === 'WALK').reduce((sum, step) => sum + (step.distanceMeters || 0), 0)
    const transitCount = steps.filter((step) => step.transitDetails).length
    const seconds = durationSeconds(route.duration)
    const arrival = new Date(arrivalTime)
    const leave = new Date(arrival.getTime() - seconds * 1000)
    const fare = Number(route.travelAdvisory?.transitFare?.units || 0)

    return {
      minutes: Math.max(1, Math.round(seconds / 60)),
      fare: fare || Math.max(15, Math.round((route.distanceMeters || 0) / 1000 * 3)),
      walk,
      transfers: Math.max(0, transitCount - 1),
      wait: Math.max(3, transitCount * 3),
      confidence: transitCount ? 'High' : 'Medium',
      leave: formatIndiaTime(leave),
      returnBy: 'Not confirmed',
      steps: steps.length ? steps.map(routeStepText) : ['Follow the live Google transit route'],
    }
  } catch {
    return fallbackRoute(origin, destination, arrivalTime)
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

async function returnRouteMatrix(places, destinations, departureTime) {
  try {
    const body = await googleFetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': googleApiKey,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,status,condition',
      },
      body: JSON.stringify({
        origins: places.map((place) => ({ waypoint: { location: { latLng: { latitude: place.location.latitude, longitude: place.location.longitude } } } })),
        destinations: destinations.map((point) => ({ waypoint: { location: { latLng: { latitude: point.lat, longitude: point.lng } } } })),
        travelMode: 'TRANSIT',
        departureTime,
      }),
    }, 12000)
    return body
  } catch {
    return []
  }
}

function closingTime(place, meetingDate) {
  const descriptions = place.regularOpeningHours?.weekdayDescriptions || []
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' }).format(meetingDate)
  const description = descriptions.find((item) => item.startsWith(day))
  if (!description) return 'Check hours'
  if (/closed/i.test(description)) return 'Closed that day'
  const times = description.match(/\d{1,2}:\d{2}\s?[AP]M/gi)
  return times?.length ? times[times.length - 1] : 'Check hours'
}

function placeTags(place) {
  const types = new Set(place.types || [])
  const tags = []
  if (place.outdoorSeating || types.has('park') || types.has('tourist_attraction')) tags.push('Outdoor')
  if (types.has('museum') || types.has('art_gallery') || types.has('library')) tags.push('Quiet')
  if (place.reservable || types.has('restaurant')) tags.push('Private')
  if (place.servesCoffee || types.has('cafe') || types.has('coffee_shop')) tags.push('Food-focused')
  if (types.has('park') || types.has('museum') || types.has('art_gallery')) tags.push('Scenic')
  if (!tags.length) tags.push('Casual')
  return [...new Set(tags)].slice(0, 3)
}

function areaFromAddress(place) {
  const address = place.shortFormattedAddress || place.formattedAddress || 'Kochi'
  return address.split(',').slice(0, 2).join(',').trim()
}

function fallbackPayload(reason) {
  return {
    source: 'curated',
    venues: seededVenues,
    warning: reason || 'Google Maps is not configured; using the curated Kochi dataset.',
    generatedAt: new Date().toISOString(),
  }
}

async function buildLiveVenues(form) {
  const origins = await Promise.all([
    geocode(form.location1, form.location1Coords),
    geocode(form.location2, form.location2Coords),
  ])
  const center = midpoint(origins[0], origins[1])
  const meetingTime = effectiveMeetingTime(form.date, form.time)
  const meetingEnd = new Date(meetingTime.getTime() + Number(form.duration || 90) * 60000)
  const places = await searchPlaces(center, { ...form, origins })
  if (!places.length) throw new Error('Google Places returned no suitable Kochi venues')

  const routesByPlace = await mapWithConcurrency(places, 5, async (place) => {
    const destination = { lat: place.location.latitude, lng: place.location.longitude }
    return Promise.all(origins.map((origin) => computeTransitRoute(origin, destination, meetingTime.toISOString())))
  })
  const returnMatrix = await returnRouteMatrix(places, origins, meetingEnd.toISOString())
  const returns = new Map(returnMatrix.map((item) => [`${item.originIndex}:${item.destinationIndex}`, item]))

  const liveVenues = places.map((place, index) => {
    const routes = routesByPlace[index]
    const returnTimes = routes.map((route, travellerIndex) => {
      const item = returns.get(`${index}:${travellerIndex}`)
      if (!item?.duration || item.condition === 'ROUTE_NOT_FOUND') return null
      return new Date(meetingEnd.getTime() + durationSeconds(item.duration) * 1000)
    })
    routes.forEach((route, travellerIndex) => {
      route.returnBy = returnTimes[travellerIndex] ? formatIndiaTime(returnTimes[travellerIndex]) : 'Not confirmed'
    })
    const tags = placeTags(place)
    const venueCost = priceByLevel[place.priceLevel] ?? 650
    const returnFeasible = returnTimes.every(Boolean)

    return {
      id: place.id,
      source: 'google',
      googleMapsUri: place.googleMapsUri,
      name: place.displayName?.text || 'Kochi venue',
      area: areaFromAddress(place),
      kind: place.primaryTypeDisplayName?.text || 'Meeting place',
      tags,
      rating: place.rating || 4,
      ratingCount: place.userRatingCount || 0,
      quiet: tags.includes('Quiet') ? 88 : tags.includes('Outdoor') ? 74 : 66,
      venueCost,
      closes: closingTime(place, meetingTime),
      walkFromTransit: Math.min(...routes.map((route) => route.walk || 0)),
      reason: `Live Google venue with ${place.rating ? `${place.rating.toFixed(1)} stars` : 'strong local relevance'}, matched to your budget and journey balance.`,
      lat: place.location.latitude,
      lon: place.location.longitude,
      routes,
      returnFeasible,
      returnNote: returnFeasible
        ? `Google found return transit routes after the meeting; estimated home times are ${routes[0].returnBy} and ${routes[1].returnBy}.`
        : 'A return transit route could not be confirmed for both travellers. Check the live route before choosing this venue.',
    }
  })

  const filtered = form.returnRequired ? liveVenues.filter((venue) => venue.returnFeasible) : liveVenues
  return {
    source: 'google',
    venues: filtered.length >= 3 ? filtered : liveVenues,
    origins,
    effectiveArrivalTime: meetingTime.toISOString(),
    warning: filtered.length < 3 && form.returnRequired ? 'Few return routes were confirmed, so all live results are shown with clear warnings.' : null,
    generatedAt: new Date().toISOString(),
  }
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, googleConfigured: Boolean(googleApiKey), cachedSearches: cache.size })
})

app.post('/api/venues/search', async (request, response) => {
  const form = request.body || {}
  if (!form.location1?.trim() || !form.location2?.trim()) {
    response.status(400).json({ error: 'Both starting locations are required.' })
    return
  }
  if (!googleApiKey) {
    response.json(fallbackPayload())
    return
  }

  const cacheKey = JSON.stringify({
    location1: form.location1,
    location2: form.location2,
    location1Coords: form.location1Coords,
    location2Coords: form.location2Coords,
    date: form.date,
    time: form.time,
    duration: form.duration,
    purpose: form.purpose,
    returnRequired: form.returnRequired,
  })
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    response.json({ ...cached.payload, cached: true })
    return
  }

  try {
    const payload = await buildLiveVenues(form)
    cache.set(cacheKey, { createdAt: Date.now(), payload })
    response.json(payload)
  } catch (error) {
    console.error('Live venue search failed:', error.message)
    response.json(fallbackPayload(`Live Google search failed: ${error.message}. Showing curated Kochi data instead.`))
  }
})

app.listen(port, '127.0.0.1', () => {
  console.log(`Halfway API listening on http://127.0.0.1:${port}`)
})
