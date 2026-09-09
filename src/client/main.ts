// Client entry. Loads the Layout from the backend and renders one Card per entry.
//
// The token sheet is imported first and on purpose: it must define every var(--*)
// before any component style resolves one.
import '../../design-system/tokens.css'
import './app.css'
import './lib/K7Audiometer.svelte'
import './lib/K7Card.svelte'
import './lib/K7ShoppingList.svelte'
import './lib/K7Timer.svelte'
import './lib/K7Weather.svelte'

import { domReconnectUi, reconnectLoop } from './lib/reconnect.ts'
import { createPager } from './lib/pager.ts'

import type { Card, CardType, NormalisedLayout } from '../shared/layout.ts'

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
let pager: { destroy(): void } | undefined
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

function render(layout: NormalisedLayout): void {
  if (!deck) return
  // Idempotent: boot() runs again after a reconnect, and appending a second set
  // of pages is the obvious way to get that wrong.
  deck.replaceChildren()

  const track = document.createElement('div')
  track.className = 'pager-track'

  const pages = layout.pages.map((page) => {
    const el = document.createElement('section')
    el.className = 'page'
    el.id = `page-${page.id}`
    const columns = page.grid?.columns ?? layout.grid.columns
    el.style.setProperty('--deck-cols', String(columns))

    // An EXPLICIT row template, because `grid-row: 1 / -1` resolves -1 against
    // the explicit grid: with only `grid-auto-rows` the rows are implicit, -1 is
    // line 1, and a card asking for the whole column silently gets one cell.
    //
    // A full-column card takes a column to itself, so the rest share what is
    // left — that is what decides the row count, not the raw card total.
    const fullColumn = page.cards.filter((c) => c.span?.rows === 0).length
    const rest = page.cards.length - fullColumn
    const restColumns = Math.max(1, columns - fullColumn)
    const rows = Math.max(1, fullColumn > 0 ? Math.ceil(rest / restColumns) : Math.ceil(page.cards.length / columns))
    el.style.setProperty('--deck-rows', String(rows))
    const gap = page.grid?.gap ?? layout.grid.gap
    if (gap) el.style.setProperty('--card-gap', gap)

    for (const card of page.cards) {
      const card_el = createWidget(card)
      card_el.id = card.id
      if (card.span?.cols && card.span.cols > 1) {
        card_el.style.gridColumn = `span ${Math.min(card.span.cols, columns)}`
      }
      // `rows` is in the layout contract and was being ignored, so a card could
      // never occupy a full column however the file asked. `rows: 0` is the way
      // a file says "all of them" without having to know how many there are.
      // `!== undefined`, not truthiness: 0 is the value that means "the whole
      // column", and a truthiness test skips exactly the case being added.
      if (card.span?.rows !== undefined) {
        card_el.style.gridRow = card.span.rows > 0 ? `span ${card.span.rows}` : '1 / -1'
      }
      el.appendChild(card_el)
    }
    return el
  })

  for (const page of pages) track.appendChild(page)
  deck.appendChild(track)

  // Dots only when there is more than one page: an indicator showing a single
  // dot is chrome that says nothing.
  if (layout.pages.length > 1) {
    const dots = document.createElement('nav')
    dots.className = 'pager-dots'
    dots.setAttribute('aria-label', 'strony')
    for (const page of layout.pages) {
      const dot = document.createElement('span')
      dot.className = 'pager-dot'
      dot.title = page.label ?? page.id
      dots.appendChild(dot)
    }
    deck.appendChild(dots)
  }

  pager?.destroy()
  pager = createPager(deck, layout.pages.map((p) => ({ id: p.id, label: p.label })))
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

function rememberLayout(layout: NormalisedLayout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout))
  } catch {
    // A kiosk with storage disabled still works; it just blanks on reload.
  }
}

function lastKnownLayout(): NormalisedLayout | undefined {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    return raw ? (JSON.parse(raw) as NormalisedLayout) : undefined
  } catch {
    return undefined
  }
}

async function loadLayout(): Promise<NormalisedLayout> {
  const res = await fetch('/api/layout')
  if (!res.ok) throw new Error(`layout ${res.status}`)
  return (await res.json()) as NormalisedLayout
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
    case 'audiometer': {
      const el = document.createElement('k7-audiometer')
      for (const [name, key] of [
        ['historyDurationSeconds', 'historyDurationSeconds'],
        ['sampleIntervalMs', 'sampleIntervalMs'],
        ['unit', 'unit'],
        ['showCurrentLevel', 'showCurrentLevel'],
        ['showHistogram', 'showHistogram'],
        ['smoothingFactor', 'smoothingFactor'],
        ['warningThreshold', 'warningThreshold'],
        ['micDeviceId', 'micDeviceId'],
      ] as const) {
        attr(el, name, params[key])
      }
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

/** Re-entrancy guard: recovery calls boot(), and two overlapping boots would
 *  each replace the deck, which is the flicker this whole fix is about. */
let booting = false

async function boot(): Promise<void> {
  if (booting) return
  booting = true
  try {
    const layout = await loadLayout()
    render(layout)
    rememberLayout(layout)
    setStatus('ONLINE', true)
    booting = false
    if (foot) {
      const cards = layout.pages.reduce((n, p) => n + p.cards.length, 0)
      const pagesLabel = layout.pages.length > 1 ? ` // ${layout.pages.length} strony` : ''
      foot.textContent = `> ${cards} kart${pagesLabel} // motyw: ${layout.theme.split('/').pop()}`
    }
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
    booting = false
    // Probe the thing actually needed, not a proxy for it.
    //
    // This used to poll /api/health and then call boot() again on success. When
    // the health check passed but the layout did not — a shape the renderer
    // could not read, say, because the page was running an older bundle against
    // a newer server — recovery succeeded, boot failed, recovery ran again, with
    // no delay between them. Each pass replaced every card in the deck, which is
    // a tight loop that looks exactly like the screen flickering.
    //
    // Probing the layout itself removes the gap: there is no state where the
    // probe is satisfied and the caller still is not.
    await reconnectLoop({
      probe: loadLayout,
      ui: domReconnectUi(),
      onRecovered: () => {
        booting = false
        void boot()
      },
    })
  }
}

registerServiceWorker()
void boot()
