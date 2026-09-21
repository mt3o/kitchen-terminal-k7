/**
 * The admin panel — a laptop page, not a kiosk card.
 *
 * The token in `localStorage` decides what this page *shows*. It decides
 * nothing about what the server accepts: every request below carries the token
 * as a header and the server compares it in constant time, answering 404 when
 * it does not match. Hiding the button is a convenience so the panel is not
 * covered in controls that would fail; it is not the security boundary, and it
 * would be a mistake to start treating it as one.
 *
 * Deliberately plain DOM, no Svelte: this page never runs on the iPad, has no
 * card contract to honour, and adding it to the component system would mean
 * maintaining it there forever for one screen that shows two buttons.
 */
import './admin.css'

const TOKEN_KEY = 'k7.adminToken'

interface GoogleStatus {
  connected: boolean
  source: 'db' | 'env' | 'none'
  accountEmail?: string | null
  scope?: string
  reason?: 'no-credentials' | 'undecryptable' | 'no-client'
  canConnect: boolean
  redirectUri: string | null
}

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const locked = el('locked')
const google = el('google')
const stateLine = el('google-state')
const detailLine = el('google-detail')
const connectButton = el<HTMLButtonElement>('google-connect')
const disconnectButton = el<HTMLButtonElement>('google-disconnect')

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    // Private browsing, or storage disabled. The panel is then usable only for
    // the length of this page load, which is better than a blank screen.
    return null
  }
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const token = readToken()
  return fetch(path, {
    ...init,
    headers: { ...(init.headers ?? {}), 'x-k7-admin-token': token ?? '' },
  })
}

/** Why there is no usable credential, in the household's language. */
const REASONS: Record<NonNullable<GoogleStatus['reason']>, string> = {
  'no-credentials': 'Brak tokenu — połącz konto albo ustaw GOOGLE_OAUTH_REFRESH_TOKEN.',
  // A stored row that will not open is a misconfiguration, not an empty state:
  // saying "not connected" here would hide the actual problem.
  undecryptable: 'W bazie jest zapisane poświadczenie, którego nie da się odszyfrować — K7_SECRET_KEY nie pasuje.',
  'no-client': 'Brak GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET w .env.local.',
}

const SOURCES: Record<GoogleStatus['source'], string> = {
  db: 'z bazy (połączone przez przeglądarkę)',
  env: 'ze zmiennej środowiskowej',
  none: '—',
}

async function refresh(): Promise<void> {
  const res = await api('/api/admin/google/status')
  if (res.status === 404) {
    // Either the token is wrong or the routes are not registered at all. The
    // server does not distinguish, and neither should this page.
    showLocked('Token odrzucony albo panel wyłączony na serwerze.')
    return
  }
  if (!res.ok) {
    stateLine.textContent = `błąd: ${res.status}`
    return
  }
  const status = (await res.json()) as GoogleStatus
  locked.hidden = true
  google.hidden = false

  stateLine.textContent = status.connected ? `POŁĄCZONE — ${SOURCES[status.source]}` : 'NIEPOŁĄCZONE'
  stateLine.dataset.connected = String(status.connected)

  const parts: string[] = []
  if (status.connected && status.accountEmail) parts.push(`konto: ${status.accountEmail}`)
  if (status.connected && status.scope) parts.push(`zakres: ${status.scope}`)
  if (!status.connected && status.reason) parts.push(REASONS[status.reason])
  if (!status.canConnect) parts.push('Połączenie przez przeglądarkę wymaga klienta OAuth i K7_HOSTNAME.')
  else if (status.redirectUri) parts.push(`redirect URI: ${status.redirectUri}`)
  detailLine.textContent = parts.join(' · ')

  connectButton.disabled = !status.canConnect
  disconnectButton.disabled = status.source !== 'db'
}

function showLocked(message?: string): void {
  locked.hidden = false
  google.hidden = true
  if (message) {
    const note = locked.querySelector('.meta')
    if (note) note.textContent = message
  }
}

el('token-save').addEventListener('click', () => {
  const input = el<HTMLInputElement>('token-input')
  try {
    localStorage.setItem(TOKEN_KEY, input.value.trim())
  } catch {
    /* nothing to do: the request below still carries the value this page load */
  }
  input.value = ''
  void refresh()
})

el('token-forget').addEventListener('click', () => {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* already gone as far as this page is concerned */
  }
  showLocked()
})

connectButton.addEventListener('click', async () => {
  const res = await api('/api/admin/google/auth/start', { method: 'POST' })
  if (!res.ok) {
    detailLine.textContent = `nie udało się rozpocząć: ${res.status}`
    return
  }
  const { url } = (await res.json()) as { url: string }
  // Same tab: the consent ends on our own callback page, which tells the
  // household what happened. A popup would be blocked as often as not.
  window.location.href = url
})

disconnectButton.addEventListener('click', async () => {
  if (!window.confirm('Rozłączyć konto Google?')) return
  const res = await api('/api/admin/google/disconnect', { method: 'POST' })
  if (!res.ok) {
    detailLine.textContent = `nie udało się rozłączyć: ${res.status}`
    return
  }
  await refresh()
})

if (readToken()) void refresh()
else showLocked()
