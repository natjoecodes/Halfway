import test from 'node:test'
import assert from 'node:assert/strict'
import { venues } from '../src/data/venues.js'
import { estimateRoute, parseMeetingTime, planVenues, resolveLocalLocation, waterMetroRoute } from './planner.js'

const form = {
  date: '2026-07-25', time: '19:00', duration: '90', purpose: 'Romantic date',
  moods: ['Quiet', 'Scenic'], travelBudget: 120, meetingBudget: 1000,
  maxWalking: 1600, returnRequired: false,
}

test('offline Kochi location index resolves common aliases', () => {
  assert.equal(resolveLocalLocation('aluva').area, 'Aluva')
  assert.equal(resolveLocalLocation('medical college').area, 'Kalamassery')
})

test('different exact origins produce different journeys', () => {
  const aluva = resolveLocalLocation('aluva')
  const fortKochi = resolveLocalLocation('fort kochi')
  const venue = venues.find((item) => item.name === 'Kashi Art Cafe')
  const meeting = parseMeetingTime(form.date, form.time)
  const end = new Date(meeting.getTime() + 90 * 60000)
  assert.notEqual(estimateRoute(aluva, venue, meeting, end).minutes, estimateRoute(fortKochi, venue, meeting, end).minutes)
})

test('planner calculates scores and enforces hard constraints', () => {
  const origins = [resolveLocalLocation('aluva'), resolveLocalLocation('kakkanad')]
  const plan = planVenues(venues, origins, form)
  assert.ok(plan.venues.length >= 3)
  assert.ok(plan.venues.every((venue) => Number.isFinite(venue.fairness) && Number.isFinite(venue.match)))
  assert.ok(plan.venues.every((venue) => venue.routes.length === 2))
})

test('official Water Metro facts are used for supported terminal pairs', () => {
  const highCourt = resolveLocalLocation('high court')
  const venue = venues.find((item) => item.name === 'Kashi Art Cafe')
  const route = waterMetroRoute(highCourt, venue)
  assert.ok(route.modes.includes('WATER_METRO'))
  assert.equal(route.waterMetro.from, 'HighCourt')
  assert.equal(route.waterMetro.to, 'Fort Kochi')
})
