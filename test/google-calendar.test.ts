/**
 * Google Calendar's token-refresh request shaping and events-mapping logic,
 * tested against fixture JSON responses rather than a live Google account —
 * mirrors `kilo.test.ts`'s pattern of testing request/response shaping
 * without a real upstream (this project's OAuth2 refresh token is obtained
 * manually by the household; live verification is theirs to run, see
 * plan.md Phase 5).
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import {
  createGoogleCalendarClient,
  googleCalendarCacheKey,
  hasGoogleCalendarCredentials,
  mapGoogleEvent,
} from '../src/server/upstream/google-calendar.ts'

const CREDS = { clientId: 'test-client', clientSecret: 'test-secret', refreshToken: 'test-refresh' }

describe('hasGoogleCalendarCredentials', () => {
  it('is true only when all three fields are present', () => {
    assert.equal(hasGoogleCalendarCredentials(CREDS), true)
  })

  it('is false when any one field is missing', () => {
    assert.equal(hasGoogleCalendarCredentials({ clientId: 'x', clientSecret: 'y' }), false)
    assert.equal(hasGoogleCalendarCredentials({}), false)
  })
})

describe('googleCalendarCacheKey', () => {
  it('keys by the Google calendarId', () => {
    assert.equal(googleCalendarCacheKey('primary'), 'google-calendar:primary')
  })
})

describe('mapGoogleEvent', () => {
  it('maps a timed event', () => {
    const event = mapGoogleEvent({
      id: 'evt1',
      status: 'confirmed',
      summary: 'Zebranie',
      start: { dateTime: '2026-09-08T10:00:00+02:00' },
      end: { dateTime: '2026-09-08T11:00:00+02:00' },
    })
    assert.deepEqual(event, {
      id: 'evt1',
      title: 'Zebranie',
      start: '2026-09-08T10:00:00+02:00',
      end: '2026-09-08T11:00:00+02:00',
      allDay: undefined,
    })
  })

  it('maps an all-day event using the bare date, not a timestamp', () => {
    const event = mapGoogleEvent({
      id: 'evt2',
      summary: 'Dzien wolny',
      start: { date: '2026-09-10' },
      end: { date: '2026-09-11' },
    })
    assert.equal(event?.start, '2026-09-10')
    assert.equal(event?.allDay, true)
  })

  it('drops a cancelled instance rather than showing it as an event', () => {
    assert.equal(
      mapGoogleEvent({ id: 'evt3', status: 'cancelled', start: { dateTime: '2026-09-08T10:00:00Z' }, end: { dateTime: '2026-09-08T11:00:00Z' } }),
      undefined,
    )
  })

  it('drops an entry missing a usable start or end rather than throwing', () => {
    assert.equal(mapGoogleEvent({ id: 'evt4', summary: 'No dates' }), undefined)
  })
})

describe('createGoogleCalendarClient', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  function stubTokenAndEvents(tokenResponse: unknown, eventsResponse: unknown): { calls: { url: string; init?: RequestInit }[] } {
    const calls: { url: string; init?: RequestInit }[] = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      const isTokenCall = String(url).includes('oauth2.googleapis.com/token')
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => (isTokenCall ? tokenResponse : eventsResponse),
      }
    }) as unknown as typeof fetch
    return { calls }
  }

  it('exchanges the refresh token via a standard refresh_token grant', async () => {
    const { calls } = stubTokenAndEvents({ access_token: 'access-1', expires_in: 3600, token_type: 'Bearer' }, { items: [] })
    const client = createGoogleCalendarClient(CREDS)
    await client.fetchEvents({ calendarId: 'primary', from: new Date('2026-09-07T00:00:00Z'), to: new Date('2026-09-14T00:00:00Z') })

    const tokenCall = calls.find((c) => c.url.includes('oauth2.googleapis.com/token'))
    assert.ok(tokenCall)
    assert.equal(tokenCall.init?.method, 'POST')
    const body = new URLSearchParams(tokenCall.init?.body as string)
    assert.equal(body.get('client_id'), 'test-client')
    assert.equal(body.get('client_secret'), 'test-secret')
    assert.equal(body.get('refresh_token'), 'test-refresh')
    assert.equal(body.get('grant_type'), 'refresh_token')
  })

  it('sends the fresh access token as a bearer header on the events call', async () => {
    const { calls } = stubTokenAndEvents({ access_token: 'access-1', expires_in: 3600, token_type: 'Bearer' }, { items: [] })
    const client = createGoogleCalendarClient(CREDS)
    await client.fetchEvents({ calendarId: 'primary', from: new Date('2026-09-07T00:00:00Z'), to: new Date('2026-09-14T00:00:00Z') })

    const eventsCall = calls.find((c) => c.url.includes('/events'))
    assert.ok(eventsCall)
    assert.equal((eventsCall.init?.headers as Record<string, string>).authorization, 'Bearer access-1')
    assert.ok(eventsCall.url.includes('singleEvents=true'), 'must ask Google to expand recurring events itself')
    assert.ok(eventsCall.url.includes(encodeURIComponent('2026-09-07T00:00:00.000Z')))
  })

  it('reuses a cached access token instead of refreshing on every call', async () => {
    const { calls } = stubTokenAndEvents({ access_token: 'access-1', expires_in: 3600, token_type: 'Bearer' }, { items: [] })
    let nowMs = new Date('2026-09-07T00:00:00Z').getTime()
    const client = createGoogleCalendarClient(CREDS, { now: () => new Date(nowMs) })
    const query = { calendarId: 'primary', from: new Date('2026-09-07T00:00:00Z'), to: new Date('2026-09-14T00:00:00Z') }

    await client.fetchEvents(query)
    nowMs += 60_000 // one minute later, well inside the 1h token lifetime
    await client.fetchEvents(query)

    assert.equal(calls.filter((c) => c.url.includes('oauth2.googleapis.com/token')).length, 1)
  })

  it('refreshes again once the cached token has expired', async () => {
    const { calls } = stubTokenAndEvents({ access_token: 'access-1', expires_in: 3600, token_type: 'Bearer' }, { items: [] })
    let nowMs = new Date('2026-09-07T00:00:00Z').getTime()
    const client = createGoogleCalendarClient(CREDS, { now: () => new Date(nowMs) })
    const query = { calendarId: 'primary', from: new Date('2026-09-07T00:00:00Z'), to: new Date('2026-09-14T00:00:00Z') }

    await client.fetchEvents(query)
    nowMs += 3600_000 // a full hour later — past expiry, even with the safety margin
    await client.fetchEvents(query)

    assert.equal(calls.filter((c) => c.url.includes('oauth2.googleapis.com/token')).length, 2)
  })

  it('maps a real events.list response shape into CalendarEvent[]', async () => {
    stubTokenAndEvents(
      { access_token: 'access-1', expires_in: 3600, token_type: 'Bearer' },
      {
        items: [
          { id: 'a', summary: 'Poranna kawa', status: 'confirmed', start: { dateTime: '2026-09-08T08:00:00+02:00' }, end: { dateTime: '2026-09-08T08:30:00+02:00' } },
          { id: 'b', summary: 'Odwolane', status: 'cancelled', start: { dateTime: '2026-09-08T09:00:00+02:00' }, end: { dateTime: '2026-09-08T10:00:00+02:00' } },
        ],
      },
    )
    const client = createGoogleCalendarClient(CREDS)
    const events = await client.fetchEvents({ calendarId: 'primary', from: new Date('2026-09-07T00:00:00Z'), to: new Date('2026-09-14T00:00:00Z') })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.title, 'Poranna kawa')
  })
})
