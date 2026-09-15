<!--
  Calendar. Ships as a custom element (k7-calendar) wrapping the shared
  <Card> shell, same pattern as K7ShoppingList.svelte.

  Supports any number of configured calendars (`params.calendar.calendars`),
  each fetched independently — one dead .ics feed or an unconfigured Google
  account never blanks the others. A tab strip only renders once there is
  more than one: with a single calendar this card is pixel-identical to the
  single-calendar layout it has always had (`calendar-tabs` deck,
  `single-calendar` state).

  A calendar with no credentials configured (Google) or nothing cached at
  all (either source) never shows an empty grid: the former falls back to
  the same obviously-mocked events this card has always shown when nothing
  real was configured (`usingMockData`-equivalent, state="idle"); the latter
  shows a synthetic all-day "load error" placeholder scoped to that one
  calendar's own tab (`calendar-tabs` deck, degraded states). Neither is
  ever presented as real — the dishonest-cache mistake this project's
  freshness rules exist to rule out.
-->
<svelte:options
  customElement={{
    tag: 'k7-calendar',
    props: {
      calendars: { reflect: true },
      view: { reflect: true },
    },
  }}
/>

<script lang="ts">
  import Card from './Card.svelte'
  import {
    calendarTickColor,
    formatRange,
    groupByDay,
    isSameDay,
    selectEventsForTab,
    startOfWeek,
    syntheticErrorWeek,
    weekDays,
    type Calendar,
    type CalendarEvent,
    type ThemeLuminanceMode,
  } from './calendar.ts'

  interface Props {
    /** JSON-encoded Calendar[] — custom-element attrs are strings. */
    calendars?: string
    /** "week" | "day" — custom-element attrs are strings. */
    view?: string
  }

  let { calendars: calendarsAttr = '[]', view = 'week' }: Props = $props()

  function isCalendarShaped(value: unknown): value is Calendar {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as Calendar).id === 'string' &&
      typeof (value as Calendar).source === 'object' &&
      (value as Calendar).source !== null
    )
  }

  // Same JSON-attribute parsing idiom as K7Menu.svelte's own `items` prop:
  // try/catch + Array.isArray + a structural filter, never a bare cast.
  let calendarsList = $derived.by((): Calendar[] => {
    try {
      const parsed = JSON.parse(calendarsAttr) as unknown
      return Array.isArray(parsed) ? parsed.filter(isCalendarShaped) : []
    } catch {
      return []
    }
  })

  type CalendarFetchStatus = 'ok' | 'stale' | 'no-cache' | 'not-configured'

  let dayView = $derived(view.trim().toLowerCase() === 'day')

  let eventsByCalendar = $state<Record<string, CalendarEvent[]>>({})
  let statusByCalendar = $state<Record<string, CalendarFetchStatus>>({})
  let selectedTab = $state('main')

  /**
   * `today` ticks. A wall display runs for months, so a date captured once at
   * component init stops being today at the first midnight and the highlighted
   * column silently drifts a day behind — on a calendar, which is the one card
   * whose whole job is telling you what day it is.
   */
  let today = $state(new Date())
  $effect(() => {
    // A minute is far finer than needed to catch midnight and costs nothing
    // next to the clock card, which already ticks.
    const id = setInterval(() => {
      const now = new Date()
      if (!isSameDay(now, today)) today = now
    }, 60_000)
    return () => clearInterval(id)
  })

  let weekStart = $derived(startOfWeek(today))
  let days = weekDays(weekStart)
  const displayDays = $derived(dayView ? days.filter((d) => isSameDay(d, today)) : days)

  const DOW = ['PN', 'WT', 'SR', 'CZ', 'PT', 'SB', 'ND']

  let selectedEvents = $derived(selectEventsForTab(calendarsList, eventsByCalendar, selectedTab))
  let buckets = $derived(groupByDay(selectedEvents, weekStart))
  let displayBuckets = $derived(
    dayView ? [buckets[days.findIndex((d) => isSameDay(d, today))] ?? []] : buckets,
  )

  /**
   * A handful of clearly fabricated events, dated relative to *this* run so
   * the fallback never looks stale or reads as a frozen fixture — Tuesday's
   * dentist, Thursday's grocery run, an all-day reminder on Saturday.
   */
  function mockEvents(calendarId: string): CalendarEvent[] {
    const at = (dayOffset: number, h: number, m: number): string => {
      // A local throwaway inside a generator, never held as state; a reactive
      // Date would buy nothing here.
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const d = new Date(weekStart)
      d.setDate(d.getDate() + dayOffset)
      d.setHours(h, m, 0, 0)
      return d.toISOString()
    }
    return [
      { id: `mock-${calendarId}-1`, title: 'dentysta', start: at(1, 9, 0), end: at(1, 9, 30), calendarId },
      { id: `mock-${calendarId}-2`, title: 'zakupy', start: at(3, 17, 30), end: at(3, 18, 30), calendarId },
      { id: `mock-${calendarId}-3`, title: 'trening', start: at(3, 19, 0), end: at(3, 20, 0), calendarId },
      { id: `mock-${calendarId}-4`, title: 'wizyta rodzinna', start: at(5, 0, 0), end: at(5, 0, 0), allDay: true, calendarId },
    ]
  }

  function setCalendarResult(calendarId: string, events: CalendarEvent[], status: CalendarFetchStatus): void {
    eventsByCalendar = { ...eventsByCalendar, [calendarId]: events }
    statusByCalendar = { ...statusByCalendar, [calendarId]: status }
  }

  interface AgedCalendarResponse {
    ageSeconds: number
    stale: boolean
    source: string
    data: CalendarEvent[]
  }

  function calendarQuery(cal: Calendar): URLSearchParams {
    // A local throwaway, never held as state — same non-reactive case as
    // mockEvents' own throwaway Date above.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const params = new URLSearchParams({ id: cal.id })
    if (cal.source.mode === 'google') {
      params.set('mode', 'google')
      params.set('calendarId', cal.source.calendarId)
    } else {
      params.set('mode', 'ics')
      params.set('url', cal.source.url)
    }
    return params
  }

  async function loadCalendar(cal: Calendar, signal: AbortSignal): Promise<void> {
    try {
      const res = await fetch(`/api/calendar/week?${calendarQuery(cal)}`, { signal })
      if (!res.ok) {
        // A not-configured Google calendar is not this calendar failing —
        // it was never going to have real data until credentials exist.
        // Falls back to the same obviously-fake demo data this card has
        // always shown, not the synthetic error-day treatment below.
        const body = (await res.json().catch(() => undefined)) as { code?: string } | undefined
        if (body?.code === 'not-configured') {
          setCalendarResult(cal.id, mockEvents(cal.id), 'not-configured')
          return
        }
        throw new Error(`calendar ${res.status}`)
      }
      const aged = (await res.json()) as AgedCalendarResponse
      const events = aged.data.map((e) => ({ ...e, calendarId: cal.id }))
      setCalendarResult(cal.id, events, aged.stale ? 'stale' : 'ok')
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      // Nothing cached and the fetch itself failed: a synthetic all-day
      // placeholder, scoped to this one calendar, so one broken source
      // never blanks the others sharing the merged main tab.
      setCalendarResult(cal.id, syntheticErrorWeek(cal.id, weekStart), 'no-cache')
    }
  }

  $effect(() => {
    const controller = new AbortController()
    for (const cal of calendarsList) void loadCalendar(cal, controller.signal)
    return () => controller.abort()
  })

  let cardState = $derived.by((): 'ok' | 'warn' | 'fail' | 'idle' => {
    const statuses = calendarsList.map((c) => statusByCalendar[c.id])
    if (statuses.length === 0 || statuses.some((s) => s === undefined)) return 'idle' // still loading
    if (statuses.some((s) => s === 'no-cache')) return 'fail'
    if (statuses.some((s) => s === 'stale')) return 'warn'
    if (statuses.some((s) => s === 'not-configured')) return 'idle'
    return 'ok'
  })

  let meta = $derived.by((): string => {
    if (cardState === 'fail') return 'brak danych'
    if (calendarsList.some((c) => statusByCalendar[c.id] === 'not-configured')) return 'dane przykladowe'
    return ''
  })

  function tabGlyph(calendarId: string): string {
    const status = statusByCalendar[calendarId]
    if (status === 'no-cache') return ' [X]'
    if (status === 'stale') return ' [!]'
    return ''
  }

  // The colour tick is computed against the theme's own luminance mode
  // (calendarTickColor's per-mode lightness is what clears the 3:1 floor) —
  // read from the document root, since theme-toggle.ts sets it there, not
  // from anything reactive inside this shadow root.
  let themeMode = $state<ThemeLuminanceMode>('dark')
  $effect(() => {
    const root = document.documentElement
    const readMode = (): void => {
      const m = root.dataset.mode
      themeMode = m === 'light' || m === 'dark' || m === 'night' ? m : 'dark'
    }
    readMode()
    const observer = new MutationObserver(readMode)
    observer.observe(root, { attributes: true, attributeFilter: ['data-mode'] })
    return () => observer.disconnect()
  })

  /** `undefined` (no inline override, CSS falls back to the plain border) whenever there is only one calendar — pixel-identical to the single-calendar layout. */
  function tickColorFor(calendarId: string | undefined): string | undefined {
    if (calendarsList.length <= 1 || !calendarId) return undefined
    const index = calendarsList.findIndex((c) => c.id === calendarId)
    return index === -1 ? undefined : calendarTickColor(index, calendarsList.length, themeMode)
  }

  // Native overflow-x does the actual scrolling; this only stops the strip's
  // own swipe from also being read as a page-level gesture — same
  // interference-avoidance reasoning as K7Carousel.svelte's own touch
  // handlers, not its slide-snap math (there is none here).
  function stopTabsPropagation(e: TouchEvent): void {
    e.stopPropagation()
  }
</script>

<Card label="LOG.WYDARZENIA" {meta} state={cardState} fullscreen>
  {#if calendarsList.length > 1}
    <div
      class="tabs"
      role="tablist"
      aria-label="kalendarze"
      tabindex="-1"
      ontouchstart={stopTabsPropagation}
      ontouchmove={stopTabsPropagation}
      ontouchend={stopTabsPropagation}
    >
      <button
        type="button"
        class="tab"
        class:tab-active={selectedTab === 'main'}
        role="tab"
        aria-selected={selectedTab === 'main'}
        onclick={() => (selectedTab = 'main')}
      >{selectedTab === 'main' ? '[ GŁÓWNY ]' : 'GŁÓWNY'}</button>
      {#each calendarsList as cal (cal.id)}
        <button
          type="button"
          class="tab"
          class:tab-active={selectedTab === cal.id}
          role="tab"
          aria-selected={selectedTab === cal.id}
          title={cal.name}
          onclick={() => (selectedTab = cal.id)}
        >{selectedTab === cal.id ? `[ ${cal.name} ]` : cal.name}{tabGlyph(cal.id)}</button>
      {/each}
    </div>
  {/if}
  <div class="week" class:day-view={dayView} role="grid" aria-label="wydarzenia tygodnia">
    {#each displayDays as day, i (day.getTime())}
      {@const isToday = isSameDay(day, today)}
      <div class="col" class:col-today={isToday} role="row">
        <div class="col-head">
          <span class="date-line">
            <span class="dow">{DOW[(day.getDay() + 6) % 7]}</span>
            <span class="num">{day.getDate()}</span>
          </span>
          {#if isToday}<span class="today-mark">dzis</span>{/if}
        </div>
        <div class="col-body">
          {#if (displayBuckets[i] ?? []).length === 0}
            <p class="empty">—</p>
          {:else}
            {#each displayBuckets[i] ?? [] as event (event.id)}
              {@const tick = tickColorFor(event.calendarId)}
              <div class="event" style={tick ? `--calendar-tick-color: ${tick}` : undefined}>
                <span class="time">{formatRange(event)}</span>
                <span class="title">{event.title}</span>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    {/each}
  </div>
</Card>

<style>
  /* A week of seven equal-width columns squeezed a card at this card's
     actual on-screen width to about 60px per day — "dentysta" wrapped
     letter by letter ("dent" / "ysta"). Each day is a full-width row
     instead, stacked vertically and scrolled as a whole: at the card's
     normal height that shows roughly two and a half days at once, with the
     rest one scroll gesture away, and every event title gets the card's
     full width to wrap in rather than a seventh of it. Each `.col` was
     already `role="row"` even in the old side-by-side layout — this makes
     the CSS match the ARIA it was already claiming. */
  .week {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    gap: var(--space-2);
    overflow-y: auto;
  }

  .week.day-view { gap: 0; }

  /* Same ghost-button recipe as Card.svelte's own `.fullscreen-btn`,
     duplicated rather than shared for the same shadow-root reason its own
     comment gives: this component's output lives in a different shadow
     root than Card's, which a light-DOM stylesheet cannot reach. */
  .tabs {
    display: flex;
    gap: var(--space-2);
    overflow-x: auto;
    padding-bottom: var(--space-1);
    flex: 0 0 auto;
  }

  .tab {
    flex: 0 0 auto;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-label);
    min-height: var(--control-h-sm);
    padding: var(--space-1) var(--space-2);
    display: inline-flex;
    align-items: center;
    background: transparent;
    color: var(--fg-muted);
    border: var(--border-w) solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    max-width: 10em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tab:hover { background: var(--ghost-hover); color: var(--fg); }
  .tab:active { background: var(--ghost-active); }
  .tab:focus {
    outline: var(--focus-w) solid var(--focus);
    outline-offset: var(--focus-offset);
  }
  @supports selector(:focus-visible) {
    .tab:focus:not(:focus-visible) { outline: none; }
  }
  /* Brackets are literal characters in the label text (matching the
     [ + ]/[ MOTYW: JASNY ] convention) — colour alone never carries which
     tab is active. */
  .tab-active {
    color: var(--fg);
    border-color: var(--border-strong);
  }

  .col {
    flex: 0 0 auto;
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    min-width: 0;
    border-bottom: var(--border-w) solid var(--border);
    padding-bottom: var(--space-2);
  }

  .col:last-child { border-bottom: none; padding-bottom: 0; }

  /* Colour never carries the "today" cue alone: a border step plus the
     "dzis" text label both mark it, so it still reads at an angle or for a
     colour-vision-deficient viewer. */
  .col-today {
    border-left: var(--border-w-strong) solid var(--accent);
    padding-left: var(--space-2);
  }

  /* Fixed width, not auto: an auto-sized head lets "DZIS" on today's row
     (or a two-digit vs one-digit date) push that row's events further
     right than every other row's, so the event list's left edge zigzags
     from day to day instead of lining up in a column. */
  .col-head {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    flex: 0 0 auto;
    width: var(--space-12);
  }

  /* DOW and the date number share a line: the first line of .col-head is
     what visually aligns with the first line of .col-body (flex-start on
     .col), and that needs to be the number people actually orient by, not
     the small muted DOW label sitting alone above it. */
  .date-line {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
  }

  .dow {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--fg-muted);
  }

  .num {
    font-size: var(--text-lg);
    font-variant-numeric: tabular-nums;
    color: var(--fg);
  }

  .col-today .num { color: var(--accent); }

  .today-mark {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--accent);
  }

  .col-body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  /* Left-aligned, not centered: centering it in the remaining row width
     floats it in empty space disconnected from the date it belongs to —
     left-aligned, it reads as part of the same row as the date badge. */
  .empty {
    margin: 0;
    text-align: left;
    color: var(--fg-disabled);
    font-size: var(--text-sm);
  }

  .event {
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: var(--space-1);
    min-height: var(--control-h-sm);
    background: var(--surface-sunken);
    border: var(--border-w) solid var(--border);
    /* Falls back to the plain border colour when --calendar-tick-color is
       unset (one calendar, or none) — pixel-identical to the pre-multi-
       calendar layout in that case. */
    border-left: var(--border-w-strong) solid var(--calendar-tick-color, var(--border));
    border-radius: var(--radius);
  }

  .time {
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    color: var(--fg-muted);
  }

  .title {
    font-size: var(--text-sm);
    color: var(--fg);
    overflow-wrap: anywhere;
  }

  .day-view .col-body { gap: var(--space-2); }
  .day-view .event { min-height: var(--control-h-sm); }
</style>
