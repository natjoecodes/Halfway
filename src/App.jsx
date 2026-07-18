import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Bus,
  Check,
  ChevronDown,
  Clock3,
  IndianRupee,
  MapPin,
  Navigation,
  Route,
  Search,
  Share2,
  Ship,
  Sparkles,
  TrainFront,
  Users,
  WalletCards,
} from 'lucide-react'
import './App.css'
import { venues as seededVenues } from './data/venues.js'

const loadingSteps = [
  'Finding reachable neighbourhoods',
  'Comparing public-transport journeys',
  'Checking budgets and opening hours',
  'Balancing both travellers\' effort',
]

const purposes = ['Romantic date', 'Business meeting', 'Friends hanging out', 'Casual catch-up', 'Work / study session']
const moods = ['Quiet', 'Lively', 'Scenic', 'Private', 'Outdoor', 'Laptop-friendly']
const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
let googleMapsLoader

function loadGoogleMaps() {
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps)
  if (!googleMapsApiKey) return Promise.reject(new Error('Google Maps API key is not configured'))
  if (googleMapsLoader) return googleMapsLoader

  googleMapsLoader = new Promise((resolve, reject) => {
    const callbackName = '__halfwayGoogleMapsReady'
    window[callbackName] = () => {
      delete window[callbackName]
      resolve(window.google.maps)
    }

    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(googleMapsApiKey)}&loading=async&libraries=places&v=weekly&callback=${callbackName}`
    script.async = true
    script.onerror = () => reject(new Error('Google Maps could not be loaded'))
    document.head.appendChild(script)
  })

  return googleMapsLoader
}

function GooglePlaceField({ value, onChange, onPlaceSelect, travellerName }) {
  const containerRef = useRef(null)
  const callbacksRef = useRef({ onChange, onPlaceSelect })
  const [loadError, setLoadError] = useState('')

  callbacksRef.current = { onChange, onPlaceSelect }

  useEffect(() => {
    if (!googleMapsApiKey) return undefined
    let autocomplete
    let disposed = false

    const handleInput = (event) => {
      callbacksRef.current.onChange(event.target.value || '')
    }

    const handlePlaceSelect = async (event) => {
      const place = event.placePrediction.toPlace()
      await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location', 'id'] })
      const address = place.formattedAddress || place.displayName
      autocomplete.value = address
      callbacksRef.current.onPlaceSelect({
        address,
        placeId: place.id,
        lat: place.location?.lat(),
        lng: place.location?.lng(),
      })
    }

    loadGoogleMaps()
      .then(async () => {
        const { PlaceAutocompleteElement } = await window.google.maps.importLibrary('places')
        if (disposed || !containerRef.current) return

        autocomplete = new PlaceAutocompleteElement({
          includedRegionCodes: ['in'],
          locationBias: { center: { lat: 9.9816, lng: 76.2999 }, radius: 50000 },
        })
        autocomplete.className = 'google-place-autocomplete'
        autocomplete.placeholder = 'Enter you location'
        autocomplete.description = `Starting location for ${travellerName || 'traveller'}`
        autocomplete.value = value
        autocomplete.addEventListener('input', handleInput)
        autocomplete.addEventListener('gmp-select', handlePlaceSelect)
        containerRef.current.replaceChildren(autocomplete)
      })
      .catch(() => setLoadError('Google location search is unavailable. Check the API key and Places API setup.'))

    return () => {
      disposed = true
      if (autocomplete) {
        autocomplete.removeEventListener('input', handleInput)
        autocomplete.removeEventListener('gmp-select', handlePlaceSelect)
      }
    }
  }, [travellerName, value])

  if (!googleMapsApiKey) {
    return (
      <>
        <div className="input-icon google-fallback">
          <MapPin size={18} />
          <input
            required
            value={value}
            onChange={(event) => onChange(event.target.value)}
            
            placeholder="Enter you location"
          />
        </div>
        {loadError && <small className="location-message">{loadError}</small>}
      </>
    )
  }

  return (
    <>
      <div className="google-place-shell"><MapPin size={18} /><div ref={containerRef} className="google-place-host"><span>Loading Google Maps...</span></div></div>
      {loadError && <small className="location-message error">{loadError}</small>}
    </>
  )
}

function effort(route) {
  return route.minutes + (route.walk / 80) * 0.5 + route.transfers * 5 + route.wait * 0.5 + route.fare / 10
}

function scoreVenue(venue, form) {
  const efforts = venue.routes.map(effort)
  const fairness = Math.max(55, Math.round(100 - Math.abs(efforts[0] - efforts[1]) * 2))
  const moodMatch = form.moods.reduce((sum, mood) => sum + (venue.tags.includes(mood) ? 5 : 0), 0)
  const budgetPenalty = venue.venueCost > form.meetingBudget ? 10 : 0
  const walkPenalty = Math.max(...venue.routes.map((route) => route.walk)) > form.maxWalking ? 8 : 0
  const purposeMatch = venue.tags.some((tag) => form.purpose.toLowerCase().includes(tag.toLowerCase())) ? 5 : 0
  const match = Math.min(98, Math.round(68 + venue.rating * 3 + moodMatch + purposeMatch - budgetPenalty - walkPenalty))
  return { ...venue, fairness, match, totalCost: venue.venueCost + venue.routes[0].fare + venue.routes[1].fare }
}

function Journey({ name, route }) {
  return (
    <div className="journey">
      <div className="journey-head">
        <div><span>Journey for</span><strong>{name || 'Traveller'}</strong></div>
        <strong>{route.minutes} min</strong>
      </div>
      <div className="journey-stats">
        <span><IndianRupee size={14} />{route.fare}</span>
        <span><Route size={14} />{route.walk} m walk</span>
        <span><Navigation size={14} />{route.transfers} transfer{route.transfers === 1 ? '' : 's'}</span>
      </div>
      <div className="timeline">
        {route.steps.map((step, index) => (
          <div className="timeline-step" key={step}>
            <span className="dot">{index + 1}</span><p>{step}</p>
          </div>
        ))}
      </div>
      <div className="journey-foot">
        <span>Leave by <strong>{route.leave}</strong></span>
        <span className={`confidence ${route.confidence.toLowerCase()}`}>{route.confidence} confidence</span>
      </div>
    </div>
  )
}

function App() {
  const [form, setForm] = useState({
    person1: '', location1: '', person2: '', location2: '',
    location1Coords: null, location2Coords: null,
    date: new Date().toISOString().slice(0, 10), time: '19:20', duration: '90', purpose: 'Romantic date', moods: ['Quiet', 'Scenic'],
    travelBudget: 120, meetingBudget: 800, maxWalking: 900, returnRequired: true,
  })
  const [view, setView] = useState('form')
  const [loadingIndex, setLoadingIndex] = useState(0)
  const [sort, setSort] = useState('match')
  const [selectedId, setSelectedId] = useState(1)
  const [copied, setCopied] = useState(false)
  const [venueOptions, setVenueOptions] = useState(seededVenues)
  const [dataSource, setDataSource] = useState('curated')
  const [sourceMessage, setSourceMessage] = useState('Curated Kochi data is ready as a fallback.')

  const ranked = useMemo(() => {
    const calculated = venueOptions.map((venue) => scoreVenue(venue, form))
    return calculated.sort((a, b) => {
      if (sort === 'fairness') return b.fairness - a.fairness
      if (sort === 'fastest') return Math.max(...a.routes.map((r) => r.minutes)) - Math.max(...b.routes.map((r) => r.minutes))
      if (sort === 'cheapest') return a.totalCost - b.totalCost
      if (sort === 'walking') return Math.max(...a.routes.map((r) => r.walk)) - Math.max(...b.routes.map((r) => r.walk))
      return b.match + b.fairness - (a.match + a.fairness)
    })
  }, [form, sort, venueOptions])

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const updateLocation = (locationKey, coordinateKey, value) => setForm((current) => ({
    ...current,
    [locationKey]: value,
    [coordinateKey]: null,
  }))
  const updatePlace = (locationKey, coordinateKey, place) => setForm((current) => ({
    ...current,
    [locationKey]: place.address,
    [coordinateKey]: { lat: place.lat, lng: place.lng, placeId: place.placeId },
  }))
  const toggleMood = (mood) => setForm((current) => ({
    ...current,
    moods: current.moods.includes(mood) ? current.moods.filter((item) => item !== mood) : [...current.moods, mood].slice(-3),
  }))

  const search = async (event) => {
    event.preventDefault()
    setView('loading')
    setLoadingIndex(0)
    const startedAt = Date.now()
    let step = 0
    const interval = window.setInterval(() => {
      step += 1
      setLoadingIndex(Math.min(step, loadingSteps.length - 1))
    }, 420)

    try {
      const response = await fetch('/api/venues/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Venue search failed')
      if (!payload.venues?.length) throw new Error('No suitable venues were returned')

      setVenueOptions(payload.venues)
      setDataSource(payload.source)
      setSourceMessage(payload.warning || (payload.source === 'google'
        ? `${payload.venues.length} live Google venues with transit routes were compared.`
        : 'Using the curated Kochi fallback dataset.'))
      setSelectedId(payload.venues[0].id)
      if (payload.origins) {
        setForm((current) => ({
          ...current,
          location1Coords: payload.origins[0],
          location2Coords: payload.origins[1],
        }))
      }
    } catch (error) {
      setVenueOptions(seededVenues)
      setDataSource('curated')
      setSourceMessage(`${error.message}. Showing reliable curated Kochi data instead.`)
      setSelectedId(seededVenues[0].id)
    } finally {
      const remainingDelay = Math.max(0, 1500 - (Date.now() - startedAt))
      await new Promise((resolve) => window.setTimeout(resolve, remainingDelay))
      window.clearInterval(interval)
      setView('results')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const share = async () => {
    const venue = ranked.find((item) => item.id === selectedId) || ranked[0]
    const text = `${form.person1} and ${form.person2} are meeting at ${venue.name}, ${venue.area} on ${form.date} at ${form.time}. Fairness score: ${venue.fairness}/100.`
    try {
      if (navigator.share) await navigator.share({ title: 'Our Halfway plan', text })
      else await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  if (view === 'loading') {
    return (
      <main className="loading-screen">
        <div className="brand"><span className="brand-mark"><MapPin size={21} /></span>Halfway</div>
        <div className="loading-content">
          <div className="route-animation"><span /><span /><span /></div>
          <p className="eyebrow">Building a fair plan</p>
          <h1>{loadingSteps[loadingIndex]}<span className="ellipsis">...</span></h1>
          <div className="loading-list">
            {loadingSteps.map((step, index) => (
              <div className={index <= loadingIndex ? 'done' : ''} key={step}>
                <span>{index < loadingIndex ? <Check size={14} /> : index + 1}</span>{step}
              </div>
            ))}
          </div>
        </div>
      </main>
    )
  }

  if (view === 'results') {
    const winners = [
      { label: 'Best overall', icon: <Sparkles size={16} />, venue: ranked[0] },
      { label: 'Fairest journey', icon: <Users size={16} />, venue: [...ranked].sort((a, b) => b.fairness - a.fairness)[0] },
      { label: 'Best value', icon: <WalletCards size={16} />, venue: [...ranked].sort((a, b) => a.totalCost - b.totalCost)[0] },
    ]
    const selected = ranked.find((venue) => venue.id === selectedId) || ranked[0]
    return (
      <main className="results-page">
        <header className="topbar">
          <button className="brand brand-button" onClick={() => setView('form')}><span className="brand-mark"><MapPin size={21} /></span>Halfway</button>
          <div className="plan-summary"><Users size={16} /> {form.person1} + {form.person2}<span />{form.date} at {form.time}</div>
          <button className="share-button" onClick={share}>{copied ? <Check size={18} /> : <Share2 size={18} />}{copied ? 'Copied' : 'Share plan'}</button>
        </header>
        <section className="results-hero">
          <p className="eyebrow">{ranked.length} places compared · {dataSource === 'google' ? 'Live Google data' : 'Curated fallback'}</p>
          <h1>Fair options for <em>both of you.</em></h1>
          <p>Ranked by travel effort, cost, walking, opening hours, and your preferences.</p>
          <div className={`source-note ${dataSource}`}>{sourceMessage}</div>
        </section>
        <section className="winner-grid">
          {winners.map(({ label, icon, venue }, index) => (
            <button className={`winner ${index === 0 ? 'primary' : ''}`} key={label} onClick={() => setSelectedId(venue.id)}>
              <span className="winner-label">{icon}{label}</span>
              <strong>{venue.name}</strong><span>{venue.area}</span>
              <div><b>{venue.fairness}</b><small>fairness</small><b>₹{venue.totalCost}</b><small>total</small></div>
            </button>
          ))}
        </section>
        <section className="results-layout">
          <div className="list-column">
            <div className="list-toolbar">
              <div><h2>Recommended places</h2><p>Ranked for your preferences and constraints</p></div>
              <label className="sort-control">Sort by<select value={sort} onChange={(e) => setSort(e.target.value)}><option value="match">Best match</option><option value="fairness">Fairest</option><option value="fastest">Fastest</option><option value="cheapest">Cheapest</option><option value="walking">Least walking</option></select><ChevronDown size={16} /></label>
            </div>
            <div className="venue-list">
              {ranked.map((venue, index) => (
                <article className={`venue-card ${selected.id === venue.id ? 'selected' : ''}`} key={venue.id} onClick={() => setSelectedId(venue.id)}>
                  <div className="venue-rank">0{index + 1}</div>
                  <div className="venue-main">
                    <div className="venue-title-row"><div><p>{venue.kind}</p><h3>{venue.name}</h3><span><MapPin size={14} />{venue.area}</span></div><div className="match-ring"><strong>{venue.match}</strong><small>match</small></div></div>
                    <div className="tag-row">{venue.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                    <p className="reason"><Sparkles size={15} />{venue.reason}</p>
                    <div className="route-compare">
                      {venue.routes.map((route, routeIndex) => (
                        <div key={routeIndex}><span>{routeIndex === 0 ? form.person1 : form.person2}</span><strong>{route.minutes} min</strong><small>₹{route.fare} · {route.walk} m walk</small></div>
                      ))}
                      <div className="fair-score"><span>Fairness</span><strong>{venue.fairness}<small>/100</small></strong></div>
                    </div>
                    <div className="venue-meta"><span><IndianRupee size={15} />₹{venue.venueCost} for two</span><span><Clock3 size={15} />Open until {venue.closes}</span><span><Route size={15} />{venue.walkFromTransit} m from transit</span><span>{venue.rating} rating{venue.ratingCount ? ` · ${venue.ratingCount} reviews` : ''}</span></div>
                    <details onClick={(e) => e.stopPropagation()}>
                      <summary>See both journeys <ArrowRight size={16} /></summary>
                      <div className="journey-grid"><Journey name={form.person1} route={venue.routes[0]} /><Journey name={form.person2} route={venue.routes[1]} /></div>
                      <div className="return-note"><Check size={17} /><div><strong>{venue.returnFeasible === false ? 'Return trip needs checking' : 'Return trip looks good'}</strong><span>{venue.returnNote || `Estimated home times are ${venue.routes[0].returnBy} for ${form.person1} and ${venue.routes[1].returnBy} for ${form.person2}.`}</span></div></div>
                    </details>
                  </div>
                </article>
              ))}
            </div>
          </div>
          <aside className="map-panel">
            {selected.source === 'google' ? (
              <a className="google-map-link" href={selected.googleMapsUri} target="_blank" rel="noreferrer"><MapPin size={28} /><strong>View live place details</strong><span>Open {selected.name} in Google Maps</span><ArrowRight size={18} /></a>
            ) : (
              <iframe title={`Map showing ${selected.name}`} src={`https://www.openstreetmap.org/export/embed.html?bbox=${selected.lon - 0.018}%2C${selected.lat - 0.012}%2C${selected.lon + 0.018}%2C${selected.lat + 0.012}&layer=mapnik&marker=${selected.lat}%2C${selected.lon}`} />
            )}
            <div className="map-caption"><span className="map-pin"><MapPin size={18} /></span><div><strong>{selected.name}</strong><span>{selected.area} · {selected.fairness}/100 fairness</span></div></div>
            <button className="edit-plan" onClick={() => setView('form')}>Edit preferences</button>
          </aside>
        </section>
      </main>
    )
  }

  return (
    <main className="planner-page">
      <header className="landing-nav"><div className="brand"><span className="brand-mark"><MapPin size={21} /></span>Halfway</div><span className="demo-pill">Kochi demo</span></header>
      <section className="intro">
        <p className="eyebrow">Fair meeting planner</p>
        <h1>Meet somewhere <em>fair.</em></h1>
        <p>Choose two starting points. Halfway balances travel time, cost, walking, and the kind of meeting you want.</p>
      </section>
      <form className="planner" onSubmit={search}>
        <section className="people-section">
          <div className="person-card person-one">
            <div className="person-label"><span>1</span><div><strong>First traveller</strong><small>Where are they starting?</small></div></div>
            <label>Name<input required value={form.person1} onChange={(e) => update('person1', e.target.value)} placeholder="Enter you name" /></label>
            <label>Starting location<GooglePlaceField value={form.location1} onChange={(value) => updateLocation('location1', 'location1Coords', value)} onPlaceSelect={(place) => updatePlace('location1', 'location1Coords', place)} travellerName={form.person1} /></label>
            <div className="transport-row"><span><TrainFront size={15} />Metro</span><span><Bus size={15} />Bus</span><span><Ship size={15} />Water Metro</span></div>
          </div>
          <div className="meeting-mark"><span><MapPin size={22} /></span><small>FAIR<br />SPOT</small></div>
          <div className="person-card person-two">
            <div className="person-label"><span>2</span><div><strong>Second traveller</strong><small>Where are they starting?</small></div></div>
            <label>Name<input required value={form.person2} onChange={(e) => update('person2', e.target.value)} placeholder="Enter you name" /></label>
            <label>Starting location<GooglePlaceField value={form.location2} onChange={(value) => updateLocation('location2', 'location2Coords', value)} onPlaceSelect={(place) => updatePlace('location2', 'location2Coords', place)} travellerName={form.person2} /></label>
            <div className="transport-row"><span><TrainFront size={15} />Metro</span><span><Bus size={15} />Bus</span><span><Ship size={15} />Water Metro</span></div>
          </div>
        </section>
        <section className="preferences">
          <div className="section-heading"><span>01</span><div><h2>When are you meeting?</h2><p>We’ll plan arrival and make sure both of you can get home.</p></div></div>
          <div className="field-grid time-grid"><label>Date<input type="date" value={form.date} onChange={(e) => update('date', e.target.value)} /></label><label>Arrive by<input type="time" value={form.time} onChange={(e) => update('time', e.target.value)} /></label><label>Meeting length<select value={form.duration} onChange={(e) => update('duration', e.target.value)}><option value="60">1 hour</option><option value="90">1.5 hours</option><option value="120">2 hours</option><option value="180">3 hours</option></select></label></div>
        </section>
        <section className="preferences">
          <div className="section-heading"><span>02</span><div><h2>What kind of time is this?</h2><p>Choose a purpose and up to three qualities that matter.</p></div></div>
          <div className="field-grid"><label className="purpose-field">Meeting type<select value={form.purpose} onChange={(e) => update('purpose', e.target.value)}>{purposes.map((purpose) => <option key={purpose}>{purpose}</option>)}</select></label><div className="mood-field"><label>Atmosphere</label><div className="choice-row">{moods.map((mood) => <button type="button" className={form.moods.includes(mood) ? 'active' : ''} onClick={() => toggleMood(mood)} key={mood}>{form.moods.includes(mood) && <Check size={14} />}{mood}</button>)}</div></div></div>
        </section>
        <section className="preferences last-preference">
          <div className="section-heading"><span>03</span><div><h2>Set your comfort limits</h2><p>We’ll avoid plans that stretch either person too far.</p></div></div>
          <div className="range-grid">
            <label><span>Travel budget <strong>₹{form.travelBudget} each</strong></span><input type="range" min="30" max="300" step="10" value={form.travelBudget} onChange={(e) => update('travelBudget', Number(e.target.value))} /></label>
            <label><span>Meeting budget <strong>₹{form.meetingBudget} for two</strong></span><input type="range" min="0" max="2000" step="100" value={form.meetingBudget} onChange={(e) => update('meetingBudget', Number(e.target.value))} /></label>
            <label><span>Maximum walking <strong>{form.maxWalking} m</strong></span><input type="range" min="200" max="2000" step="100" value={form.maxWalking} onChange={(e) => update('maxWalking', Number(e.target.value))} /></label>
          </div>
          <label className="toggle"><input type="checkbox" checked={form.returnRequired} onChange={(e) => update('returnRequired', e.target.checked)} /><span /><div><strong>Public transport home required</strong><small>Only show plans with a practical return journey</small></div></label>
        </section>
        <div className="submit-zone"><div><strong>Ready to meet in the middle?</strong><span>We’ll search live Kochi venues and compare transit for both travellers.</span></div><button type="submit"><Search size={19} />Find our fair spot<ArrowRight size={19} /></button></div>
      </form>
      <footer><span>Halfway</span><p>Live Google Places and Routes when configured, with a clearly labelled curated fallback. <b>Built using OpenAI Codex.</b></p></footer>
    </main>
  )
}

export default App
