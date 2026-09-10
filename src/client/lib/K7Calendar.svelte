<!--
  Calendar. Ships as a custom element (k7-calendar) wrapping the shared
  <Card> shell, same pattern as K7ShoppingList.svelte.

  There is no backend for this yet — Google OAuth2 does not exist, so
  /api/calendar/week either 404s or does not exist at all. Rather than
  showing an empty card, this falls back to a small set of obviously
  mocked events and says so in the meta line, at state="idle" — never
  "ok", because an "ok" badge over invented data is exactly the kind of
  dishonest cache this project's freshness rules exist to rule out. The
  moment the endpoint answers for real, its data is used and the card
  goes to "ok" like every other card.
-->
<svelte:options
  customElement={{
    tag: 'k7-calendar',
    props: {
      calendarId: { reflect: true },
      view: { reflect: true },
      editable: { reflect: true },
    },
  }}
/>

<script lang="ts">
  import Card from './Card.svelte'
  import { formatRange, groupByDay, isSameDay, startOfWeek, weekDays, type CalendarEvent } from './calendar.ts'

  interface Props {
    calendarId?: string
    /** "week" | "day" — custom-element attrs are strings. */
    view?: string
    /** "true" / "false" — custom-element attrs are strings, not booleans. */
    editable?: string
  }

  let { calendarId = 'primary', view = 'week', editable = 'true' }: Props = $props()

  // Not named `state`: a local `state` turns every `$state(...)` rune in this
  // file into Svelte's store-subscription syntax and the compiler blames the
  // runes rather than the name (see Card.svelte / K7ShoppingList.svelte).
  let cardState = $state<'ok' | 'idle' | 'fail'>('idle')
  let events = $state<CalendarEvent[]>([])
  let usingMockData = $state(false)
  let loadFailed = $state(false)

  let dayView = $derived(view.trim().toLowerCase() === 'day')
  // `editable` is declared so the custom element observes the attribute the
  // layout contract defines, and is deliberately inert: there is no calendar
  // write path until OAuth2 exists, and edit affordances over nothing would be
  // exactly the dishonest UI this project avoids.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _editableIsDeclaredButInert = editable

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

  let buckets = $derived(groupByDay(events, weekStart))
  let displayBuckets = $derived(
    dayView ? [buckets[days.findIndex((d) => isSameDay(d, today))] ?? []] : buckets,
  )

  let meta = $derived(usingMockData ? 'dane przykladowe' : loadFailed ? 'brak danych' : '')

  /**
   * A handful of clearly fabricated events, dated relative to *this* run so
   * the fallback never looks stale or reads as a frozen fixture — Tuesday's
   * dentist, Thursday's grocery run, an all-day reminder on Saturday.
   */
  function mockEvents(): CalendarEvent[] {
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
      { id: 'mock-1', title: 'dentysta', start: at(1, 9, 0), end: at(1, 9, 30) },
      { id: 'mock-2', title: 'zakupy', start: at(3, 17, 30), end: at(3, 18, 30) },
      { id: 'mock-3', title: 'trening', start: at(3, 19, 0), end: at(3, 20, 0) },
      { id: 'mock-4', title: 'wizyta rodzinna', start: at(5, 0, 0), end: at(5, 0, 0), allDay: true },
    ]
  }

  async function load(signal: AbortSignal): Promise<void> {
    try {
      const res = await fetch(`/api/calendar/week?calendarId=${encodeURIComponent(calendarId)}`, { signal })
      if (!res.ok) throw new Error(`calendar ${res.status}`)
      const data = (await res.json()) as CalendarEvent[]
      events = data
      usingMockData = false
      loadFailed = false
      cardState = 'ok'
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      // No backend yet: fall back to obviously-fake data rather than an
      // empty grid, but never claim it is real.
      events = mockEvents()
      usingMockData = true
      loadFailed = true
      cardState = 'idle'
    }
  }

  $effect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  })
</script>

<Card label="LOG.WYDARZENIA" {meta} state={cardState}>
  <div class="week" class:day-view={dayView} role="grid" aria-label="wydarzenia tygodnia">
    {#each displayDays as day, i (day.getTime())}
      {@const isToday = isSameDay(day, today)}
      <div class="col" class:col-today={isToday} role="row">
        <div class="col-head">
          <span class="dow">{DOW[(day.getDay() + 6) % 7]}</span>
          <span class="num">{day.getDate()}</span>
        </div>
        {#if isToday}<span class="today-mark">dzis</span>{/if}
        <div class="col-body">
          {#if (displayBuckets[i] ?? []).length === 0}
            <p class="empty">—</p>
          {:else}
            {#each displayBuckets[i] ?? [] as event (event.id)}
              <div class="event">
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
  .week {
    display: flex;
    height: 100%;
    min-height: 0;
    gap: var(--space-1);
  }

  .week.day-view { gap: 0; }

  .col {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-left: var(--border-w) solid var(--border);
    padding: 0 var(--space-1);
  }

  .col:first-child { border-left: none; padding-left: 0; }

  /* Colour never carries the "today" cue alone: a border step plus the
     "dzis" text label both mark it, so it still reads at an angle or for a
     colour-vision-deficient viewer. */
  .col-today {
    border-left: var(--border-w-strong) solid var(--accent);
    border-right: var(--border-w-strong) solid var(--accent);
  }

  .col-head {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 0 0 auto;
    padding-bottom: var(--space-1);
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
    flex: 0 0 auto;
    align-self: center;
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--accent);
    margin-bottom: var(--space-1);
  }

  .col-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .empty {
    margin: 0;
    text-align: center;
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
