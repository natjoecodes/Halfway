const OFFICIAL_BASE = 'https://watermetro.co.in'
const cache = new Map()
const CACHE_MS = 15 * 60 * 1000

export const waterMetroTerminals = [
  { name: 'Fort Kochi', lat: 9.9683540751, lon: 76.2431782032 },
  { name: 'HighCourt', lat: 9.9839113529, lon: 76.2730020961 },
  { name: 'Kakkanad', lat: 9.9933987255, lon: 76.3513450249 },
  { name: 'Vytilla', lat: 9.9674147690, lon: 76.3224033600 },
  { name: 'Vypin', lat: 9.9739974802, lon: 76.2443213209 },
  { name: 'Mattancherry', lat: 9.9589549852, lon: 76.2602763409 },
  { name: 'Willingdon Island', lat: 9.9646749405, lon: 76.2630960494 },
  { name: 'South Chittoor', lat: 10.0383689913, lon: 76.2697316209 },
  { name: 'Cheranalloor', lat: 10.0726186326, lon: 76.2826754676 },
  { name: 'Eloor', lat: 10.0741060123, lon: 76.2827883081 },
]

export const officialWaterMetroLinks = {
  source: 'Kochi Water Metro official schedule',
  url: 'https://watermetro.co.in/boat-schedule',
  accessedAt: '2026-07-19',
}

export const waterMetroRouteFacts = {
  'Fort Kochi|HighCourt': { minutes: 20, fare: 40 },
  'Fort Kochi|Vypin': { minutes: 6, fare: 20 },
  'Kakkanad|Vytilla': { minutes: 25, fare: 30 },
  'Vypin|HighCourt': { minutes: 20, fare: 30 },
  'Vypin|Bolgatty': { minutes: 20, fare: 20 },
  'HighCourt|Bolgatty': { minutes: 2, fare: 20 },
  'HighCourt|South Chittoor': { minutes: 40, fare: 40 },
  'HighCourt|Cheranalloor': { minutes: 80, fare: 60 },
  'HighCourt|Eloor': { minutes: 95, fare: 60 },
  'HighCourt|Fort Kochi': { minutes: 20, fare: 40 },
  'HighCourt|Mattancherry': { minutes: 25, fare: 40 },
  'HighCourt|Willingdon Island': { minutes: 20, fare: 30 },
  'Mattancherry|Willingdon Island': { minutes: 6, fare: 20 },
}

function routeFact(from, to) {
  return waterMetroRouteFacts[`${from}|${to}`] || waterMetroRouteFacts[`${to}|${from}`] || null
}

export async function getOfficialWaterMetroSchedule(from, to) {
  const fact = routeFact(from, to)
  if (!fact) return null
  const key = `${from}|${to}`
  const cached = cache.get(key)
  if (cached && Date.now() - cached.createdAt < CACHE_MS) return { ...cached.value, cached: true }
  const params = new URLSearchParams({ from, to })
  const response = await fetch(`${OFFICIAL_BASE}/api/schedule?${params}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'Halfway-Hackathon/1.0' },
    signal: AbortSignal.timeout(7000),
  })
  if (!response.ok) throw new Error(`Water Metro schedule failed (${response.status})`)
  const rows = await response.json()
  const value = { ...fact, departures: rows, provenance: officialWaterMetroLinks }
  cache.set(key, { createdAt: Date.now(), value })
  return value
}
