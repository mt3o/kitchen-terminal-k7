// Client entry. Loads the Layout from the backend and renders one Card per entry.
//
// The token sheet is imported first and on purpose: it must define every var(--*)
// before any component style resolves one.
import '../../design-system/tokens.css'
import './app.css'
import './lib/K7Card.svelte'
import './lib/K7ShoppingList.svelte'
import './lib/K7Timer.svelte'
import './lib/K7Weather.svelte'

import { domReconnectUi, reconnectLoop } from './lib/reconnect.ts'

import type { Card, CardType, Layout } from '../shared/layout.ts'

/** Polish HUD labels, keyed by card type. Labels uppercase, data lowercase. */
const LABELS: Record<CardType, string> = {
  weather: 'SYS.POGODA',
  calendar: 'LOG.WYDARZENIA',
  chat: 'CHAT.AI',
  recipes: 'BAZA.PRZEPISY',
  'shopping-list': 'LISTA.ZAKUPY',
  timer: 'MINUTNIK',
  'comic-of-the-day': 'KOMIKS.DNIA',
  'ascii-art-of-the-day': 'ASCII.DNIA',
  carousel: 'KARUZELA',
  grid: 'SIATKA',
  slideshow: 'POKAZ',
  clock: 'ZEGAR',
  menu: 'MENU',
  audiometer: 'AUDIOMETR',
}

const deck = document.getElementById('deck')
const status = document.getElementById('status')
const foot = document.getElementById('foot')

function setStatus(text: string, ok: boolean): void {
  if (status) status.textContent = `STATUS: ${text}`
  if (status) status.style.color = ok ? 'var(--signal)' : 'var(--fail)'
}

function clockFace(card: Card, el: HTMLElement): void {
  const params = (card.params ?? {}) as { locale?: string; showSeconds?: boolean; showDate?: boolean }
  const locale = params.locale ?? 'pl-PL'
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    ...(params.showSeconds ? { second: '2-digit' } : {}),
    hour12: false,
  })
  const date = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' })

  const tick = (): void => {
    const now = new Date()
    el.setAttribute('glance', time.format(now))
    if (params.showDate !== false) el.setAttribute('body', date.format(now))
    el.setAttribute('meta', now.toISOString().slice(11, 19))
  }
  tick()
  // 1s is enough: the face shows minutes unless showSeconds is set, and a
  // wall display that is on all day should not wake more often than it must.
  window.setInterval(tick, params.showSeconds ? 1000 : 15_000)
}

function render(layout: Layout): void {
  if (!deck) return
  // Idempotent: boot() runs again after a reconnect, and appending a second set
  // of cards to the deck is the obvious way to get that wrong.
  deck.replaceChildren()
  deck.style.setProperty('--deck-cols', String(layout.grid.columns))
  if (layout.grid.gap) deck.style.setProperty('--card-gap', layout.grid.gap)

  for (const card of layout.cards) {
    const el = createWidget(card)
    el.id = card.id
    if (card.span?.cols && card.span.cols > 1) {
      el.style.gridColumn = `span ${Math.min(card.span.cols, layout.grid.columns)}`
    }
    deck.appendChild(el)
  }
}

/**
 * The shell is cached so the wall keeps painting across a backend restart. Data
 * is not: the backend owns freshness and answers with an age, and a second cache
 * in front of it would answer with a lie.
 *
 * Registration is guarded because a Service Worker needs a secure context, and a
 * LAN IP over plain HTTP is not one — `navigator.serviceWorker` is undefined
 * there, and the kiosk must still work, just without the shell cache.
 */
function registerServiceWorker(): void {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((err: unknown) => {
      // Never fatal: a failed registration costs the offline shell, not the app.
      console.warn('service worker registration failed', err)
    })
  })
}

/**
 * The last good Layout, kept on the device.
 *
 * The Service Worker deliberately does not cache /api — the backend owns data
 * freshness and a second cache in front of it would answer with a lie. But the
 * Layout is not upstream data, it is the shape of the screen, and without it a
 * reload during an outage paints an empty deck: a scrim over nothing, when the
 * whole design is a scrim over the *stale grid*. So the shape is kept here and
 * the data behind it is not.
 */
const LAYOUT_KEY = 'k7:last-layout'

function rememberLayout(layout: Layout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout))
  } catch {
    // A kiosk with storage disabled still works; it just blanks on reload.
  }
}

function lastKnownLayout(): Layout | undefined {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    return raw ? (JSON.parse(raw) as Layout) : undefined
  } catch {
    return undefined
  }
}

async function loadLayout(): Promise<Layout> {
  const res = await fetch('/api/layout')
  if (!res.ok) throw new Error(`layout ${res.status}`)
  return (await res.json()) as Layout
}

/**
 * Build the element for a card.
 *
 * A type with its own custom element gets it; everything else falls back to the
 * generic shell showing `[--] oczekuje na implementacje`. Saying a card is not
 * built yet is honest; a spinner that never resolves is not, and on a wall
 * display nobody is there to conclude it has hung.
 */
function createWidget(card: Card): HTMLElement {
  const params = (card.params ?? {}) as Record<string, unknown>
  const attr = (el: HTMLElement, name: string, value: unknown): void => {
    if (value !== undefined && value !== null) el.setAttribute(name, String(value))
  }

  switch (card.type) {
    case 'weather': {
      const el = document.createElement('k7-weather')
      const loc = (params.location ?? {}) as { lat?: number; lon?: number }
      attr(el, 'lat', loc.lat)
      attr(el, 'lon', loc.lon)
      attr(el, 'units', params.units)
      attr(el, 'refresh', card.refreshIntervalSeconds)
      return el
    }
    case 'timer': {
      const el = document.createElement('k7-timer')
      const presets = params.presetsMinutes
      if (Array.isArray(presets)) attr(el, 'presets', presets.join(','))
      attr(el, 'soundOnComplete', params.soundOnComplete)
      return el
    }
    case 'shopping-list': {
      const el = document.createElement('k7-shopping-list')
      attr(el, 'groupByCategory', params.groupByCategory)
      attr(el, 'showCheckedItems', params.showCheckedItems)
      return el
    }
    case 'clock': {
      const el = document.createElement('k7-card')
      el.setAttribute('label', LABELS.clock)
      el.setAttribute('state', 'ok')
      clockFace(card, el)
      return el
    }
    default: {
      const el = document.createElement('k7-card')
      el.setAttribute('label', LABELS[card.type] ?? card.type.toUpperCase())
      el.setAttribute('state', 'idle')
      el.setAttribute('body', 'oczekuje na implementacje')
      el.setAttribute('meta', card.type)
      return el
    }
  }
}

async function boot(): Promise<void> {
  try {
    const layout = await loadLayout()
    render(layout)
    rememberLayout(layout)
    setStatus('ONLINE', true)
    if (foot) foot.textContent = `> ${layout.cards.length} kart // motyw: ${layout.theme.split('/').pop()}`
  } catch (err) {
    // The last screen stays on the wall, blurred behind the scrim, while this
    // runs. Never blank, and never presented as current.
    // Paint the last known screen before the scrim goes over it, so what is
    // behind the blur is the grid the household last saw rather than a void.
    const remembered = lastKnownLayout()
    if (remembered) render(remembered)
    setStatus('BRAK POLACZENIA', false)
    if (foot) {
      foot.textContent = remembered
        ? `> ostatni znany uklad // ${err instanceof Error ? err.message : 'brak polaczenia'}`
        : `> ${err instanceof Error ? err.message : 'nieznany blad'}`
    }
    await reconnectLoop({
      probe: async () => {
        const res = await fetch('/api/health', { cache: 'no-store' })
        if (!res.ok) throw new Error(`health ${res.status}`)
        return res
      },
      ui: domReconnectUi(),
      onRecovered: () => { void boot() },
    })
  }
}

registerServiceWorker()
void boot()
