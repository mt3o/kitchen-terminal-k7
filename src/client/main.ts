// Client entry. Loads the Layout from the backend and renders one Card per entry.
//
// The token sheet is no longer imported here: it is generated from the theme
// the layout names and linked in index.html, which is what makes swapping the
// design a matter of pointing `theme:` at another file rather than editing an
// import. app.css still comes from the bundle.
import './app.css'
import './lib/K7AsciiArt.svelte'
import './lib/K7Audiometer.svelte'
import './lib/K7Calendar.svelte'
import './lib/K7Card.svelte'
import './lib/K7Carousel.svelte'
import './lib/K7Chat.svelte'
import './lib/K7Comic.svelte'
import './lib/K7Grid.svelte'
import './lib/K7Menu.svelte'
import './lib/K7Recipes.svelte'
import './lib/K7ShoppingList.svelte'
import './lib/K7Timer.svelte'
import './lib/K7Weather.svelte'

import { domReconnectUi, reconnectLoop } from './lib/reconnect.ts'
import { createChangelogUi } from './lib/changelog.ts'
import { createPullToRefresh } from './lib/pull-refresh.ts'
import { createPager, type Pager } from './lib/pager.ts'
import { createSlideshowController, extractSlideshow, isForbiddenNestedSlideshow, type SlideshowController } from './lib/slideshow.ts'

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
let pager: Pager | undefined
let slideshowController: SlideshowController | undefined
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

function render(rawLayout: NormalisedLayout): void {
  if (!deck) return
  // Idempotent: boot() runs again after a reconnect, and appending a second set
  // of pages is the obvious way to get that wrong.
  deck.replaceChildren()
  slideshowController?.destroy()
  slideshowController = undefined

  // `slideshow` is a layout-level controller declared inside `cards` (per the
  // schema's own KONTRAKT note), not a rendered Card: it must never reach the
  // grid row/column math below, or occupy a slot. Stripped first, once, so
  // everything after this line works with an ordinary card list exactly as
  // it always has.
  const { layout, config: slideshowConfig, warnings: slideshowWarnings } = extractSlideshow(rawLayout)
  for (const warning of slideshowWarnings) console.warn(`layout: ${warning}`)

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

  // Started only now that every card is in the DOM (`document.getElementById`
  // for each `cardIds` entry must resolve) and the pager exists (the
  // controller suspends it while fullscreen, per the pager/slideshow event
  // collision this depends on — see slideshow.ts).
  if (slideshowConfig) {
    slideshowController = createSlideshowController(slideshowConfig, { track, pager })
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
    case 'calendar': {
      const el = document.createElement('k7-calendar')
      attr(el, 'calendarId', params.calendarId)
      attr(el, 'view', params.view)
      attr(el, 'editable', params.editable)
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
    case 'ascii-art-of-the-day': {
      const el = document.createElement('k7-ascii-art')
      el.setAttribute('label', LABELS['ascii-art-of-the-day'])
      attr(el, 'prompt', params.prompt)
      attr(el, 'model', params.model)
      attr(el, 'cacheDurationHours', params.cacheDurationHours)
      attr(el, 'maxWidthChars', params.maxWidthChars)
      attr(el, 'maxHeightLines', params.maxHeightLines)
      attr(el, 'colorized', params.colorized)
      attr(el, 'seed', params.seed)
      attr(el, 'fallbackArt', params.fallbackArt)
      return el
    }
    case 'comic-of-the-day': {
      const el = document.createElement('k7-comic')
      el.setAttribute('label', LABELS['comic-of-the-day'])
      attr(el, 'rssUrl', params.rssUrl)
      attr(el, 'itemSelector', params.itemSelector)
      const keywords = params.filterKeywords
      if (Array.isArray(keywords)) attr(el, 'filterKeywords', keywords.join(','))
      attr(el, 'cacheDurationHours', params.cacheDurationHours)
      attr(el, 'maxWidthPx', params.maxWidthPx)
      attr(el, 'linkToSource', params.linkToSource)
      attr(el, 'creditText', params.creditText)
      attr(el, 'fallbackImageUrl', params.fallbackImageUrl)
      return el
    }
    case 'chat': {
      const el = document.createElement('k7-chat')
      attr(el, 'defaultModel', params.defaultModel)
      const availableModels = params.availableModels
      if (Array.isArray(availableModels) && availableModels.length > 0) {
        attr(el, 'availableModels', JSON.stringify(availableModels))
      }
      attr(el, 'contextWindowMarginPercent', params.contextWindowMarginPercent)
      attr(el, 'compactingThresholdPercent', params.compactingThresholdPercent)
      attr(el, 'voiceInput', params.voiceInput)
      return el
    }
    case 'recipes': {
      const el = document.createElement('k7-recipes')
      attr(el, 'maxVisible', params.maxVisible)
      attr(el, 'allowUrlImport', params.allowUrlImport)
      const tags = params.tags
      if (Array.isArray(tags)) attr(el, 'tags', tags.join(','))
      return el
    }
    case 'clock': {
      const el = document.createElement('k7-card')
      el.setAttribute('label', LABELS.clock)
      el.setAttribute('state', 'ok')
      clockFace(card, el)
      return el
    }
    case 'carousel': {
      const el = document.createElement('k7-carousel')
      attr(el, 'autoAdvanceSeconds', params.autoAdvanceSeconds)
      attr(el, 'startDelaySeconds', params.startDelaySeconds)
      attr(el, 'loop', params.loop)
      attr(el, 'showIndicators', params.showIndicators)
      attr(el, 'swipeEnabled', params.swipeEnabled)
      attr(el, 'transition', params.transition)
      const slides = Array.isArray(params.slides) ? (params.slides as Card[]) : []
      for (const slide of slides) el.appendChild(buildNestedChild('carousel', slide))
      return el
    }
    case 'grid': {
      const el = document.createElement('k7-grid')
      attr(el, 'columns', params.columns)
      attr(el, 'gap', params.gap)
      const cells = Array.isArray(params.cells) ? (params.cells as Card[]) : []
      for (const cell of cells) el.appendChild(buildNestedChild('grid', cell))
      return el
    }
    case 'menu': {
      const el = document.createElement('k7-menu')
      const items = Array.isArray(params.items)
        ? (params.items as { cardId: string; label: string; icon?: string }[]).filter(
            (it) => it && typeof it.cardId === 'string' && typeof it.label === 'string',
          )
        : []
      if (items.length < 2) {
        console.warn(`menu card '${card.id}': needs at least 2 valid items, got ${items.length} — picker will show what it has.`)
      }
      attr(el, 'items', JSON.stringify(items))
      attr(el, 'orientation', params.orientation)
      attr(el, 'style', params.style)
      attr(el, 'defaultActive', params.defaultActive)
      // Coordination is necessarily page-level: this component alone has the
      // full items list (from card.params) and can reach any target by id
      // across the whole document — a menu's targets may sit on any page,
      // since every page coexists in the DOM (the pager only translates
      // between them). The menu component itself never touches its targets.
      el.addEventListener('k7-menu-change', (e) => {
        const detail = (e as CustomEvent<{ cardId: string }>).detail
        for (const item of items) {
          const target = document.getElementById(item.cardId)
          if (!target) {
            console.warn(`menu card '${card.id}': item cardId '${item.cardId}' does not match any rendered card.`)
            continue
          }
          target.hidden = item.cardId !== detail.cardId
        }
      })
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

/**
 * Build one nested card for a `carousel`/`grid` container: the same
 * `createWidget`, called recursively, so a grid cell that is itself a
 * carousel (or vice versa) works exactly like any other nesting — there is
 * no separate "nested card" construction path to keep in sync.
 *
 * The one exception is `slideshow`: the schema forbids nesting it inside a
 * `carousel`'s `slides` or a `grid`'s `cells` (it is a layout-level
 * controller, not a card — see slideshow.ts). `createWidget` has no `case
 * 'slideshow'`, so one would already fall through to the generic
 * placeholder; this replaces that with an explicit diagnostic instead, since
 * "oczekuje na implementacje" (awaiting implementation) would be actively
 * wrong here — slideshow *is* implemented, just not legal in this position.
 */
function buildNestedChild(parentType: 'carousel' | 'grid', nested: Card): HTMLElement {
  if (isForbiddenNestedSlideshow(parentType, nested)) {
    console.warn(`slideshow card '${nested.id}' must not be nested inside a '${parentType}' — ignored.`)
    const el = document.createElement('k7-card')
    el.setAttribute('label', LABELS.slideshow)
    el.setAttribute('state', 'fail')
    el.setAttribute('body', 'niedozwolone zagniezdzenie')
    el.setAttribute('meta', nested.id)
    return el
  }
  const el = createWidget(nested)
  el.id = nested.id
  return el
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
createChangelogUi()
const shellHead = document.querySelector<HTMLElement>('.shell-head')
if (shellHead) {
  createPullToRefresh(shellHead, {
    // boot() re-fetches and re-renders in place; a household member pulling
    // down from the header wants the same recovery path a reconnect already
    // uses, not a hard navigation reload that would flash the shell blank.
    onRefresh: () => {
      booting = false
      return boot()
    },
  })
}
void boot()
