// Client entry. Loads the Layout from the backend and renders one Card per entry.
//
// The token sheet is imported first and on purpose: it must define every var(--*)
// before any component style resolves one.
import '../../design-system/tokens.css'
import './app.css'
import './lib/K7Card.svelte'

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
  deck.style.setProperty('--deck-cols', String(layout.grid.columns))
  if (layout.grid.gap) deck.style.setProperty('--card-gap', layout.grid.gap)

  for (const card of layout.cards) {
    const el = document.createElement('k7-card')
    el.setAttribute('label', LABELS[card.type] ?? card.type.toUpperCase())
    el.id = card.id
    if (card.span?.cols && card.span.cols > 1) {
      el.style.gridColumn = `span ${Math.min(card.span.cols, layout.grid.columns)}`
    }

    if (card.type === 'clock') {
      el.setAttribute('state', 'ok')
      clockFace(card, el)
    } else {
      // Everything else is a declared slot with no body yet. Saying so beats a
      // spinner that never resolves: [--] is the honest state.
      el.setAttribute('state', 'idle')
      el.setAttribute('body', 'oczekuje na implementacje')
      el.setAttribute('meta', card.type)
    }
    deck.appendChild(el)
  }
}

async function boot(): Promise<void> {
  try {
    const res = await fetch('/api/layout')
    if (!res.ok) throw new Error(`layout ${res.status}`)
    const layout = (await res.json()) as Layout
    render(layout)
    setStatus('ONLINE', true)
    if (foot) foot.textContent = `> ${layout.cards.length} kart // motyw: ${layout.theme.split('/').pop()}`
  } catch (err) {
    setStatus('BLAD', false)
    if (foot) foot.textContent = `> ${err instanceof Error ? err.message : 'nieznany blad'}`
  }
}

void boot()
