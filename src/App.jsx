import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Bus,
  Check,
  ChevronDown,
  Clock3,
  IndianRupee,
  LocateFixed,
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

const loadingSteps = [
  'Finding reachable neighbourhoods',
  'Comparing public-transport journeys',
  'Checking budgets and opening hours',
  'Balancing both travellers\' effort',
]

const purposes = ['Romantic date', 'Business meeting', 'Friends hanging out', 'Casual catch-up', 'Work / study session']
const moods = ['Quiet', 'Lively', 'Scenic', 'Private', 'Outdoor', 'Laptop-friendly']
function LocationField({ value, onChange, onPlaceSelect }) {
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const [locating, setLocating] = useState(false)

  const useCurrentLocation = () => {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      try {
        const response = await fetch(`/api/locations/reverse?lat=${coords.latitude}&lon=${coords.longitude}`)
        onPlaceSelect(await response.json())
      } finally {
        setLocating(false)
      }
    }, () => setLocating(false), { enableHighAccuracy: true, timeout: 10000 })
  }

  useEffect(() => {
    if (!open || value.trim().length < 2) {
      setSuggestions([])
      return undefined
    }
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/locations/suggest?q=${encodeURIComponent(value)}`, { signal: controller.signal })
        const payload = await response.json()
        setSuggestions(payload.suggestions || [])
      } catch (error) {
        if (error.name !== 'AbortError') setSuggestions([])
      }
    }, 180)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, value])

  return (
    <div className="location-field">
      <div className="input-icon">
        <MapPin size={18} />
        <input
          required
          value={value}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            onChange(event.target.value)
            setOpen(true)
          }}
          placeholder="Enter you location"
          autoComplete="off"
        />
      </div>
      <button className="gps-button" type="button" onClick={useCurrentLocation}><LocateFixed size={15} />{locating ? 'Locating...' : 'Use exact GPS location'}</button>
      {open && suggestions.length > 0 && (
        <div className="location-suggestions">
          {suggestions.map((place) => (
            <button type="button" key={`${place.name}-${place.lat}-${place.lon}`} onMouseDown={(event) => event.preventDefault()} onClick={() => {
              onPlaceSelect(place)
              setOpen(false)
            }}>
              <MapPin size={15} /><span><strong>{place.name}</strong><small>{place.address || place.area}</small></span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function initialMeetingDate() {
  const date = new Date(Date.now() + 90 * 60000)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date)
  const get = (type) => parts.find((part) => part.type === type)?.value
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
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
        <span className="confidence">{route.confidence}</span>
      </div>
      {route.provenance && <p className="route-source">{route.provenance.source} · {route.provenance.status}</p>}
      {route.officialSchedule?.length > 0 && <p className="official-times">Official departures: {route.officialSchedule.map((item) => item.departure.slice(0, 5)).join(', ')}</p>}
    </div>
  )
}

function App() {
  const initialMeeting = useMemo(initialMeetingDate, [])
  const [form, setForm] = useState({
    person1: '', location1: '', person2: '', location2: '',
    location1Coords: null, location2Coords: null,
    date: initialMeeting.date, time: initialMeeting.time, duration: '90', purpose: 'Romantic date', moods: ['Quiet', 'Scenic'],
    travelBudget: 120, meetingBudget: 800, maxWalking: 900, returnRequired: true,
  })
  const [view, setView] = useState('form')
  const [loadingIndex, setLoadingIndex] = useState(0)
  const [sort, setSort] = useState('match')
  const [selectedId, setSelectedId] = useState(1)
  const [copied, setCopied] = useState(false)
  const [venueOptions, setVenueOptions] = useState([])
  const [dataSource, setDataSource] = useState('curated-model')
  const [sourceMessage, setSourceMessage] = useState('')
  const [formError, setFormError] = useState('')
  const [candidateCount, setCandidateCount] = useState(0)

  const ranked = useMemo(() => {
    return [...venueOptions].sort((a, b) => {
      if (sort === 'fairness') return b.fairness - a.fairness
      if (sort === 'fastest') return Math.max(...a.routes.map((r) => r.minutes)) - Math.max(...b.routes.map((r) => r.minutes))
      if (sort === 'cheapest') return a.totalCost - b.totalCost
      if (sort === 'walking') return Math.max(...a.routes.map((r) => r.walk)) - Math.max(...b.routes.map((r) => r.walk))
      return b.match + b.fairness - (a.match + a.fairness)
    })
  }, [sort, venueOptions])

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const updateLocation = (locationKey, coordinateKey, value) => setForm((current) => ({
    ...current,
    [locationKey]: value,
    [coordinateKey]: null,
  }))
  const updatePlace = (locationKey, coordinateKey, place) => setForm((current) => ({
    ...current,
    [locationKey]: place.address || place.name,
    [coordinateKey]: { lat: place.lat, lon: place.lon, placeId: place.placeId, name: place.name, area: place.area, source: place.source },
  }))
  const toggleMood = (mood) => setForm((current) => ({
    ...current,
    moods: current.moods.includes(mood) ? current.moods.filter((item) => item !== mood) : [...current.moods, mood].slice(-3),
  }))

  const search = async (event) => {
    event.preventDefault()
    setFormError('')
    setView('loading')
    setLoadingIndex(0)
    const startedAt = Date.now()
    let step = 0
    let succeeded = false
    const interval = window.setInterval(() => {
      step += 1
      setLoadingIndex(Math.min(step, loadingSteps.length - 1))
    }, 420)

    try {
      const controller = new AbortController()
      const requestTimeout = window.setTimeout(() => controller.abort(), 12000)
      const response = await fetch('/api/venues/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
        signal: controller.signal,
      })
      window.clearTimeout(requestTimeout)
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Venue search failed')
      if (!payload.venues?.length) throw new Error('No suitable venues were returned')

      setVenueOptions(payload.venues)
      setDataSource(payload.source)
      setSourceMessage(payload.warning)
      setCandidateCount(payload.candidateCount || payload.venues.length)
      setSelectedId(payload.venues[0].id)
      if (payload.origins) {
        setForm((current) => ({
          ...current,
          location1Coords: payload.origins[0],
          location2Coords: payload.origins[1],
        }))
      }
      succeeded = true
    } catch (error) {
      setFormError(error.name === 'AbortError' ? 'Search timed out. Check that the Halfway API is running, then try again.' : error.message)
    } finally {
      const remainingDelay = Math.max(0, 1500 - (Date.now() - startedAt))
      await new Promise((resolve) => window.setTimeout(resolve, remainingDelay))
      window.clearInterval(interval)
      setView(succeeded ? 'results' : 'form')
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
          <p className="eyebrow">{ranked.length} shown from {candidateCount} candidates · Open data</p>
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
                    <div className="venue-meta"><span><IndianRupee size={15} />₹{venue.venueCost} budget guide</span><span><Clock3 size={15} />Open until {venue.closes}</span><span><Route size={15} />{venue.walkFromTransit} m from transit</span><span>{venue.meetsConstraints ? 'Meets all limits' : `Check ${venue.constraintIssues.join(', ')}`}</span></div>
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
            <iframe title={`Map showing ${selected.name}`} src={`https://www.openstreetmap.org/export/embed.html?bbox=${selected.lon - 0.018}%2C${selected.lat - 0.012}%2C${selected.lon + 0.018}%2C${selected.lat + 0.012}&layer=mapnik&marker=${selected.lat}%2C${selected.lon}`} />
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
        {formError && <div className="form-error">{formError}</div>}
        <section className="people-section">
          <div className="person-card person-one">
            <div className="person-label"><span>1</span><div><strong>First traveller</strong><small>Where are they starting?</small></div></div>
            <label>Name<input required value={form.person1} onChange={(e) => update('person1', e.target.value)} placeholder="Enter you name" /></label>
            <label>Starting location<LocationField value={form.location1} onChange={(value) => updateLocation('location1', 'location1Coords', value)} onPlaceSelect={(place) => updatePlace('location1', 'location1Coords', place)} /></label>
            <div className="transport-row"><span><TrainFront size={15} />Metro</span><span><Bus size={15} />Bus</span><span><Ship size={15} />Water Metro</span></div>
          </div>
          <div className="meeting-mark"><span><MapPin size={22} /></span><small>FAIR<br />SPOT</small></div>
          <div className="person-card person-two">
            <div className="person-label"><span>2</span><div><strong>Second traveller</strong><small>Where are they starting?</small></div></div>
            <label>Name<input required value={form.person2} onChange={(e) => update('person2', e.target.value)} placeholder="Enter you name" /></label>
            <label>Starting location<LocationField value={form.location2} onChange={(value) => updateLocation('location2', 'location2Coords', value)} onPlaceSelect={(place) => updatePlace('location2', 'location2Coords', place)} /></label>
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
        <div className="submit-zone"><div><strong>Ready to meet in the middle?</strong><span>Official Metro and Water Metro data, with modelled bus and walking access.</span></div><button type="submit"><Search size={19} />Find our fair spot<ArrowRight size={19} /></button></div>
      </form>
      <footer><span>Halfway</span><p>Contains data provided by Kochi Metro Rail Limited and OpenStreetMap contributors. Water Metro schedules come from the official operator. <b>Built using OpenAI Codex.</b></p></footer>
    </main>
  )
}

export default App
