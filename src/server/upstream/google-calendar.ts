/**
 * Google Calendar: the household's own calendar — read-write in principle
 * (unlike an .ics source), though this project only ever reads it. OAuth2 is
 * bounded to a refresh-token exchange plus the Calendar API's `events.list`;
 * there is no consent-flow UI anywhere in this codebase. The refresh token
 * itself is obtained manually by the household and pasted into `.env.local`,
 * the same trust boundary as the Cloudflare API token (`[node:ab43353e]`).
 *
 * Absent credentials is not this module's problem to paper over: {@link
 * hasGoogleCalendarCredentials} is a plain boundary check the caller (the
 * future `/api/calendar/week` route) uses to decide whether to call this
 * module at all. A `Calendar` configured with `source.mode === 'google'` but
 * no credentials falls through to the client's existing mock-event display —
 * the same "no placeholder data presented as real" rule every other upstream
 * in this project already follows (`[node:4a749051]`) — rather than this
 * module inventing a fallback of its own.
 */
import type { CalendarEvent } from '../domain/types.ts'

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const API_BASE = 'https://www.googleapis.com/calendar/v3'
const DEFAULT_TIMEOUT_MS = 8000
/** The API's own ceiling for `maxResults`. */
const PAGE_SIZE = 2500
/** A backstop against an upstream that never stops handing out page tokens, not a real limit — one page covers the whole window in practice. */
const MAX_PAGES = 10

/**
 * Refreshed a little before its real expiry so a request in flight never
 * starts with a token that expires mid-call.
 */
const EXPIRY_SAFETY_MARGIN_SECONDS = 60

export interface GoogleCalendarCredentials {
  clientId: string
  clientSecret: string
  refreshToken: string
}

export function hasGoogleCalendarCredentials(
  creds: Partial<GoogleCalendarCredentials>,
): creds is GoogleCalendarCredentials {
  return Boolean(creds.clientId && creds.clientSecret && creds.refreshToken)
}

interface RawTokenResponse {
  access_token: string
  expires_in: number
  token_type: string
}

interface RawGoogleEventDate {
  /** Present for an all-day event — a bare `YYYY-MM-DD`, Google's own all-day shape. */
  date?: string
  /** Present for a timed event — a full ISO 8601 timestamp. */
  dateTime?: string
}

interface RawGoogleEvent {
  id: string
  /** A cancelled instance of a recurring event still appears in the list — dropped, not shown as an event. */
  status?: 'confirmed' | 'tentative' | 'cancelled'
  summary?: string
  start?: RawGoogleEventDate
  end?: RawGoogleEventDate
}

interface RawEventsResponse {
  items?: RawGoogleEvent[]
  nextPageToken?: string
}

async function fetchWithAuthAndTimeout(url: string, headers: HeadersInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers, signal: controller.signal })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Google Calendar API responded ${res.status}${text ? `: ${text}` : ''}`)
    }
    return res
  } finally {
    clearTimeout(timer)
  }
}

async function requestAccessToken(
  creds: GoogleCalendarCredentials,
  timeoutMs: number,
): Promise<{ token: string; expiresInSeconds: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: controller.signal,
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
        grant_type: 'refresh_token',
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Google OAuth2 token refresh responded ${res.status}${text ? `: ${text}` : ''}`)
    }
    const json = (await res.json()) as RawTokenResponse
    return { token: json.access_token, expiresInSeconds: json.expires_in }
  } finally {
    clearTimeout(timer)
  }
}

export function mapGoogleEvent(raw: RawGoogleEvent): CalendarEvent | undefined {
  if (raw.status === 'cancelled') return undefined
  const allDay = raw.start?.date !== undefined
  const start = allDay ? raw.start?.date : raw.start?.dateTime
  const end = allDay ? raw.end?.date : raw.end?.dateTime
  if (!start || !end) return undefined
  return { id: raw.id, title: raw.summary ?? '', start, end, allDay: allDay || undefined }
}

export interface GoogleCalendarQuery {
  calendarId: string
  from: Date
  to: Date
}

export function googleCalendarCacheKey(calendarId: string): string {
  return `google-calendar:${calendarId}`
}

export interface GoogleCalendarClient {
  fetchEvents(query: GoogleCalendarQuery): Promise<CalendarEvent[]>
}

/**
 * The access token is cached for this client instance's lifetime, in memory
 * only — never in the `upstream_cache` table, which is for *event data*
 * freshness, not *credential* freshness. This project constructs its
 * upstream clients once at boot (see `kilo.ts`'s `createKiloGatewayClient`
 * precedent) and reuses them across requests, so this closure's lifetime is
 * effectively the server process's own.
 */
export function createGoogleCalendarClient(
  creds: GoogleCalendarCredentials,
  opts: { now?: () => Date; timeoutMs?: number } = {},
): GoogleCalendarClient {
  const now = opts.now ?? (() => new Date())
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let cachedToken: { token: string; expiresAtMs: number } | undefined

  async function getAccessToken(): Promise<string> {
    const nowMs = now().getTime()
    if (cachedToken && cachedToken.expiresAtMs > nowMs) return cachedToken.token
    const { token, expiresInSeconds } = await requestAccessToken(creds, timeoutMs)
    cachedToken = { token, expiresAtMs: nowMs + Math.max(0, expiresInSeconds - EXPIRY_SAFETY_MARGIN_SECONDS) * 1000 }
    return token
  }

  async function fetchEvents(query: GoogleCalendarQuery): Promise<CalendarEvent[]> {
    const token = await getAccessToken()
    const events: CalendarEvent[] = []
    // A 91-day window can outgrow one page (the API's default is 250 items —
    // a name-day calendar alone is one event a day), so follow nextPageToken
    // rather than silently dropping the tail of the range.
    let pageToken: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(`${API_BASE}/calendars/${encodeURIComponent(query.calendarId)}/events`)
      url.searchParams.set('timeMin', query.from.toISOString())
      url.searchParams.set('timeMax', query.to.toISOString())
      // Google expands recurring events into instances server-side when this is set —
      // there is no client-side recurrence math to do here, unlike the .ics path.
      url.searchParams.set('singleEvents', 'true')
      url.searchParams.set('orderBy', 'startTime')
      url.searchParams.set('maxResults', String(PAGE_SIZE))
      if (pageToken) url.searchParams.set('pageToken', pageToken)

      const res = await fetchWithAuthAndTimeout(url.toString(), { authorization: `Bearer ${token}` }, timeoutMs)
      const json = (await res.json()) as RawEventsResponse
      for (const item of json.items ?? []) {
        const mapped = mapGoogleEvent(item)
        if (mapped) events.push(mapped)
      }
      pageToken = json.nextPageToken
      if (!pageToken) break
    }
    return events
  }

  return { fetchEvents }
}
