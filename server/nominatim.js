import fs from 'node:fs'
import path from 'node:path'

const CACHE_PATH = path.resolve('data/cache/geocoding.json')
const KOCHI_VIEWBOX = '76.19,10.18,76.43,9.90'
let lastRequestAt = 0
let queue = Promise.resolve()

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'))
  } catch {
    return {}
  }
}

const cache = readCache()

function saveCache() {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2))
}

async function throttledFetch(url) {
  const run = async () => {
    const wait = Math.max(0, 1100 - (Date.now() - lastRequestAt))
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
    lastRequestAt = Date.now()
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Halfway-Hackathon/1.0 (meeting-place planner; local development)',
        'Accept-Language': 'en',
      },
      signal: AbortSignal.timeout(7000),
    })
    if (!response.ok) throw new Error(`OpenStreetMap geocoding failed (${response.status})`)
    return response.json()
  }
  queue = queue.then(run, run)
  return queue
}

export async function geocodeWithNominatim(query) {
  const key = `search:${query.trim().toLowerCase()}`
  if (cache[key]) return cache[key]
  const params = new URLSearchParams({
    q: `${query.trim()}, Kochi, Kerala, India`,
    format: 'jsonv2',
    limit: '1',
    bounded: '1',
    viewbox: KOCHI_VIEWBOX,
    addressdetails: '1',
  })
  const rows = await throttledFetch(`https://nominatim.openstreetmap.org/search?${params}`)
  if (!rows[0]) return null
  const row = rows[0]
  const result = {
    name: row.name || row.display_name.split(',')[0],
    address: row.display_name,
    area: row.address?.suburb || row.address?.city_district || row.address?.city || 'Kochi',
    lat: Number(row.lat),
    lon: Number(row.lon),
    source: 'OpenStreetMap Nominatim',
    osmType: row.osm_type,
    osmId: row.osm_id,
  }
  cache[key] = result
  saveCache()
  return result
}

export async function reverseWithNominatim(lat, lon) {
  const key = `reverse:${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`
  if (cache[key]) return cache[key]
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), format: 'jsonv2', addressdetails: '1' })
  const row = await throttledFetch(`https://nominatim.openstreetmap.org/reverse?${params}`)
  const result = {
    name: row.name || row.display_name?.split(',')[0] || 'Pinned location',
    address: row.display_name || `${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}`,
    area: row.address?.suburb || row.address?.city_district || row.address?.city || 'Kochi',
    lat: Number(lat),
    lon: Number(lon),
    source: 'OpenStreetMap Nominatim',
    osmType: row.osm_type,
    osmId: row.osm_id,
  }
  cache[key] = result
  saveCache()
  return result
}
