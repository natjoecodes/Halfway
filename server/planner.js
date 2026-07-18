import { kochiLocations, metroStations } from '../src/data/locations.js'
import { waterMetroRouteFacts, waterMetroTerminals } from './waterMetro.js'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const toRadians = (value) => value * Math.PI / 180

export function distanceMeters(a, b) {
  const dLat = toRadians(b.lat - a.lat)
  const dLon = toRadians((b.lon ?? b.lng) - (a.lon ?? a.lng))
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export function normalizeLocation(value = '') {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

function locationTerms(location) {
  return [location.name, location.area, ...(location.aliases || [])].map(normalizeLocation)
}

function textScore(query, location) {
  if (!query) return 0
  const terms = locationTerms(location)
  if (terms.includes(query)) return 100
  if (terms.some((term) => term.startsWith(query))) return 80
  if (terms.some((term) => term.includes(query) || query.includes(term))) return 65
  const words = query.split(' ')
  return Math.max(...terms.map((term) => words.filter((word) => term.includes(word)).length / words.length * 50))
}

export function suggestLocalLocations(query, limit = 6) {
  const normalized = normalizeLocation(query)
  if (!normalized) return kochiLocations.slice(0, limit)
  return kochiLocations
    .map((location) => ({ location, score: textScore(normalized, location) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ location }) => ({ ...location, source: 'curated' }))
}

export function resolveLocalLocation(query) {
  const normalized = normalizeLocation(query)
  const candidate = kochiLocations
    .map((location) => ({ location, score: textScore(normalized, location) }))
    .sort((a, b) => b.score - a.score)[0]
  return candidate?.score >= 65 ? { ...candidate.location, source: 'curated' } : null
}

function nearest(point, stops) {
  return stops
    .map((stop) => ({ ...stop, distance: distanceMeters(point, stop) }))
    .sort((a, b) => a.distance - b.distance)[0]
}

function formatTime(date) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(date)
}

export function parseMeetingTime(date, time) {
  const parsed = new Date(`${date}T${time}:00+05:30`)
  if (Number.isNaN(parsed.getTime())) throw new Error('Choose a valid meeting date and time.')
  return parsed
}

function routeEffort(route) {
  return route.minutes + route.walk / 120 + route.transfers * 7 + route.wait * 0.5 + route.fare / 12
}

function accessLeg(distance, label) {
  if (distance <= 900) {
    return { minutes: distance / 75, fare: 0, walk: Math.round(distance), transfers: 0, steps: [`Walk ${Math.round(distance)} m to ${label}`] }
  }
  return {
    minutes: 7 + distance / 320,
    fare: Math.max(12, Math.round(distance / 1000 * 3 + 10)),
    walk: 220,
    transfers: 1,
    steps: [`Walk about 220 m to a bus stop`, `Take a connecting bus to ${label}`],
  }
}

function directBusRoute(origin, destination) {
  const roadDistance = distanceMeters(origin, destination) * 1.24
  const walk = clamp(Math.round(180 + roadDistance * 0.025), 220, 850)
  const wait = 8
  const minutes = Math.round(wait + roadDistance / 1000 / 18 * 60 + walk / 75)
  const fare = clamp(Math.round(15 + roadDistance / 2500 * 4), 15, 65)
  return {
    minutes, fare, walk, transfers: roadDistance > 10500 ? 1 : 0, wait,
    modes: ['BUS', 'WALK'], confidence: 'Modelled',
    provenance: { source: 'OpenStreetMap distance model', status: 'Estimate; live bus GTFS unavailable' },
    steps: [`Walk about ${Math.round(walk * 0.45)} m to a bus stop`, `Take a bus towards ${destination.area || destination.name}`, `Walk about ${Math.round(walk * 0.55)} m to ${destination.name}`],
  }
}

function metroRoute(origin, destination) {
  const from = nearest(origin, metroStations)
  const to = nearest(destination, metroStations)
  if (from.distance > 5000 || to.distance > 3200 || from.name === to.name) return null
  const first = accessLeg(from.distance, `${from.name} Metro`)
  const last = accessLeg(to.distance, destination.name)
  const railDistance = distanceMeters(from, to) * 1.12
  const wait = 5
  return {
    minutes: Math.round(first.minutes + wait + railDistance / 1000 / 31 * 60 + last.minutes),
    fare: first.fare + last.fare + clamp(Math.round(18 + railDistance / 1000 * 2.5), 20, 60),
    walk: first.walk + last.walk,
    transfers: first.transfers + last.transfers,
    wait,
    modes: ['METRO', ...(first.fare || last.fare ? ['BUS'] : []), 'WALK'],
    confidence: 'Modelled',
    provenance: { source: 'KMRL GTFS 2024 + official timetable effective 17-Feb-2026', status: 'Frequency-based estimate' },
    steps: [...first.steps, `Take the Metro from ${from.name} to ${to.name}`, ...last.steps],
  }
}

export function waterMetroRoute(origin, destination) {
  const from = nearest(origin, waterMetroTerminals)
  const to = nearest(destination, waterMetroTerminals)
  const fact = waterMetroRouteFacts[`${from.name}|${to.name}`] || waterMetroRouteFacts[`${to.name}|${from.name}`]
  if (!fact || from.name === to.name || from.distance > 8500 || to.distance > 2600) return null
  const first = accessLeg(from.distance, `${from.name} Water Metro`)
  const last = accessLeg(to.distance, destination.name)
  const wait = 9
  return {
    minutes: Math.round(first.minutes + wait + fact.minutes + last.minutes),
    fare: first.fare + last.fare + fact.fare,
    walk: first.walk + last.walk,
    transfers: first.transfers + last.transfers + 1,
    wait,
    modes: ['WATER_METRO', ...(first.fare || last.fare ? ['BUS'] : []), 'WALK'],
    confidence: 'Official legs',
    waterMetro: { from: from.name, to: to.name },
    provenance: { source: 'Kochi Water Metro official schedule', url: 'https://watermetro.co.in/boat-schedule', status: 'Boat leg official; access legs modelled' },
    steps: [...first.steps, `Take the Water Metro from ${from.name} to ${to.name}`, ...last.steps],
  }
}

export function estimateRoute(origin, venue, meetingTime, meetingEnd) {
  const destination = { ...venue, lon: venue.lon ?? venue.lng }
  const candidates = [directBusRoute(origin, destination), metroRoute(origin, destination), waterMetroRoute(origin, destination)].filter(Boolean)
  const route = candidates.sort((a, b) => routeEffort(a) - routeEffort(b))[0]
  const leave = new Date(meetingTime.getTime() - route.minutes * 60000)
  const estimatedReturn = new Date(meetingEnd.getTime() + Math.round(route.minutes * 1.12) * 60000)
  const serviceEndMinutes = route.modes.includes('WATER_METRO') ? 21 * 60 + 30 : 22 * 60 + 30
  const indiaParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(meetingEnd)
  const hour = Number(indiaParts.find((part) => part.type === 'hour')?.value || 0)
  const minute = Number(indiaParts.find((part) => part.type === 'minute')?.value || 0)
  return {
    ...route,
    leave: formatTime(leave),
    returnBy: formatTime(estimatedReturn),
    returnFeasible: hour * 60 + minute <= serviceEndMinutes,
  }
}

function closingMinutes(value) {
  const match = String(value).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (!match) return null
  let hour = Number(match[1]) % 12
  if (match[3].toUpperCase() === 'PM') hour += 12
  return hour * 60 + Number(match[2])
}

function timeMinutes(date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date)
  return Number(parts.find((part) => part.type === 'hour')?.value || 0) * 60 + Number(parts.find((part) => part.type === 'minute')?.value || 0)
}

const purposeTags = {
  'Romantic date': ['Date', 'Quiet', 'Scenic', 'Private'],
  'Business meeting': ['Business', 'Quiet', 'Laptop-friendly'],
  'Friends hanging out': ['Friends', 'Lively', 'Outdoor', 'Food-focused'],
  'Casual catch-up': ['Casual', 'Quiet', 'Food-focused'],
  'Work / study session': ['Work', 'Quiet', 'Laptop-friendly'],
}

export function scoreVenue(venue, form, routes, meetingEnd) {
  const efforts = routes.map(routeEffort)
  const fairness = clamp(Math.round(100 - Math.abs(efforts[0] - efforts[1]) / Math.max(...efforts, 1) * 100), 0, 100)
  const maxMinutes = Math.max(...routes.map((route) => route.minutes))
  const maxWalk = Math.max(...routes.map((route) => route.walk))
  const travelBudgetOk = routes.every((route) => route.fare <= Number(form.travelBudget))
  const meetingBudgetOk = venue.venueCost <= Number(form.meetingBudget)
  const walkingOk = maxWalk <= Number(form.maxWalking)
  const closesAt = closingMinutes(venue.closes)
  const openingHoursOk = closesAt === null || timeMinutes(meetingEnd) <= closesAt
  const returnFeasible = routes.every((route) => route.returnFeasible)
  const desiredTags = [...(purposeTags[form.purpose] || []), ...(form.moods || [])]
  const tagMatches = new Set(desiredTags.filter((tag) => venue.tags.includes(tag))).size

  const breakdown = {
    fairness: Math.round(fairness * 0.35),
    journey: Math.round(clamp(100 - Math.max(0, maxMinutes - 20) * 1.3, 20, 100) * 0.20),
    budget: Math.round((travelBudgetOk && meetingBudgetOk ? 100 : travelBudgetOk || meetingBudgetOk ? 50 : 10) * 0.10),
    walking: Math.round(clamp(100 - maxWalk / Math.max(Number(form.maxWalking), 1) * 35, 20, 100) * 0.10),
    preferences: Math.round(clamp(45 + tagMatches * 15, 45, 100) * 0.10),
    rating: Math.round(clamp((venue.rating || 3.8) / 5 * 100, 0, 100) * 0.05),
    hours: openingHoursOk ? 5 : 0,
    return: returnFeasible ? 5 : 0,
  }
  const match = Object.values(breakdown).reduce((sum, value) => sum + value, 0)
  const issues = []
  if (!travelBudgetOk) issues.push('travel budget')
  if (!meetingBudgetOk) issues.push('meeting budget')
  if (!walkingOk) issues.push('walking limit')
  if (!openingHoursOk) issues.push('closing time')
  if (form.returnRequired && !returnFeasible) issues.push('return transport')

  return {
    ...venue,
    routes,
    fairness,
    match,
    breakdown,
    totalCost: venue.venueCost + routes[0].fare + routes[1].fare,
    returnFeasible,
    meetsConstraints: issues.length === 0,
    constraintIssues: issues,
    reason: issues.length
      ? `Strong aspects remain, but check: ${issues.join(', ')}.`
      : `${fairness}/100 journey fairness with ${tagMatches || 'a general'} preference match${routes.some((route) => route.modes.includes('WATER_METRO')) ? ' and a Water Metro option' : ''}.`,
  }
}

export function planVenues(venues, origins, form) {
  const meetingTime = parseMeetingTime(form.date, form.time)
  const meetingEnd = new Date(meetingTime.getTime() + Number(form.duration || 90) * 60000)
  const planned = venues.map((venue) => {
    const routes = origins.map((origin) => estimateRoute(origin, venue, meetingTime, meetingEnd))
    return scoreVenue(venue, form, routes, meetingEnd)
  }).sort((a, b) => (Number(b.meetsConstraints) - Number(a.meetsConstraints)) || (b.match + b.fairness) - (a.match + a.fairness))
  const eligible = planned.filter((venue) => venue.meetsConstraints)
  return {
    venues: (eligible.length >= 3 ? eligible : planned).slice(0, 8),
    relaxedConstraints: eligible.length < 3,
    meetingTime,
    meetingEnd,
  }
}
