<!--
  Weather.

  This is the first card where the freshness work becomes visible on the wall.
  The backend answers with an age and a stale flag; the card renders both, and
  when the answer is stale it says so in warn rather than showing a number that
  looks current. A temperature read from the doorway is taken as current whether
  or not anything disclaims it, so the disclaimer has to be part of the readout.
-->
<svelte:options customElement={{ tag: 'k7-weather', props: { lat: { reflect: true }, lon: { reflect: true } } }} />

<script lang="ts">
  import Card from './Card.svelte'
  import { hostIdOf, manualElIdStore, presentingElIdStore } from './fullscreen-lock.ts'
  import { stripCells, upcomingHours, type WeatherHour } from './weather-hourly.ts'
  import { ageLabel, describeWeather, isSevere, weatherArt } from './wmo.ts'

  interface Props {
    lat?: string
    lon?: string
    units?: string
    label?: string
    /** Seconds between refreshes. The upstream updates about every 15 min. */
    refresh?: string
    /** "false" hides the ASCII drawing of the current conditions. */
    showArt?: string
  }

  let {
    lat = '52.2297',
    lon = '21.0122',
    units = 'metric',
    label = 'SYS.POGODA',
    refresh = '900',
    showArt = 'true',
  }: Props = $props()

  let artEnabled = $derived(showArt.trim().toLowerCase() !== 'false')

  interface Aged {
    ageSeconds: number
    stale: boolean
    source: string
    data: {
      /** IANA zone the hours are labelled in. Absent from answers cached
       *  before the hourly series existed, like `hourly` itself. */
      timezone?: string
      units: { temperature: string; windSpeed: string; precipitation?: string; snowfall?: string }
      now: { temperature: number; apparentTemperature: number; humidity: number; windSpeed: number; weatherCode: number }
      daily: { date: string; weatherCode: number; temperatureMax: number; temperatureMin: number }[]
      hourly?: WeatherHour[]
    }
  }

  let aged = $state<Aged | undefined>(undefined)
  let failed = $state(false)

  let cardState = $derived(
    failed ? 'fail' : !aged ? 'idle' : aged.stale || isSevere(aged.data.now.weatherCode) ? 'warn' : 'ok',
  )
  let meta = $derived(aged ? ageLabel(aged.ageSeconds) : '')
  let art = $derived(aged ? weatherArt(aged.data.now.weatherCode) : undefined)

  /**
   * The clock the hourly rows trim against. It advances on EVERY load attempt,
   * failed ones included: when the upstream is down the card keeps its last
   * answer, and the strip must still move past hours that have gone by rather
   * than freeze at the last successful refresh.
   */
  let nowMs = $state(Date.now())

  async function load(signal: AbortSignal): Promise<void> {
    nowMs = Date.now()
    try {
      const res = await fetch(`/api/weather?lat=${lat}&lon=${lon}&units=${units}`, { signal })
      if (!res.ok) throw new Error(`weather ${res.status}`)
      aged = (await res.json()) as Aged
      failed = false
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      // Keep whatever is already on screen. Blanking a card because one refresh
      // failed loses information the household can still use.
      failed = true
    }
  }

  $effect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    const every = Math.max(60, Number(refresh) || 900) * 1000
    const timer = setInterval(() => void load(controller.signal), every)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  })

  // The grid cell has room for three days; a card the Slideshow is presenting
  // owns the whole screen, so it shows every day the server returned. Content,
  // not styling, hence the store rather than the `:host(...)` class alone.
  let wrapEl = $state<HTMLElement | undefined>(undefined)
  let hostId = $state<string | undefined>(undefined)
  $effect(() => {
    if (!wrapEl) return
    hostId = hostIdOf(wrapEl)
  })
  let presenting = $derived(hostId !== undefined && $presentingElIdStore === hostId)
  // Opened by hand with the card's own [ + ]: a different look from a
  // Slideshow presentation, which sets the same fullscreen class (F7).
  let manual = $derived(hostId !== undefined && $manualElIdStore === hostId)

  // Same breakpoint as every phone rule in this app. JS needs it too: the strip
  // RENDERS four cells on a phone rather than hiding two of six.
  let phone = $state(false)
  $effect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const update = (): void => {
      phone = mq.matches
    }
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  })

  let timeZone = $derived(aged?.data.timezone ?? 'Europe/Warsaw')
  let upcoming = $derived(upcomingHours(aged?.data.hourly, nowMs, 72))
  let strip = $derived(stripCells(upcoming, phone ? 4 : 6, timeZone, nowMs))
  let forecast = $derived(aged ? aged.data.daily.slice(1, presenting ? undefined : 4) : [])

  const round = (n: number): string => (Number.isFinite(n) ? String(Math.round(n)) : '--')
  const day = (iso: string): string =>
    new Date(iso).toLocaleDateString('pl-PL', { weekday: 'short' }).replace('.', '')
</script>

<Card label={label} meta={meta} state={cardState as 'ok' | 'warn' | 'fail' | 'idle'} fullscreen>
  <div class="wrap" bind:this={wrapEl}>
  {#if failed && !aged}
    <p class="msg">brak danych pogodowych</p>
  {:else if !aged}
    <p class="msg">odczyt</p>
  {:else}
    <div class="now">
      {#if artEnabled && art}
        <!-- Decorative: the temperature and the label beside it already say
             everything this draws, so a screen reader gets nothing new here. -->
        <pre class="art" aria-hidden="true">{art}</pre>
      {/if}
      <div class="readout">
        <p class="glance">{round(aged.data.now.temperature)}<span class="unit">{aged.data.units.temperature}</span></p>
        <p class="cond">{describeWeather(aged.data.now.weatherCode)}</p>
      </div>
    </div>
    <dl class="detail">
      <div><dt>odczuwalna</dt><dd>{round(aged.data.now.apparentTemperature)}{aged.data.units.temperature}</dd></div>
      <div><dt>wilgotnosc</dt><dd>{round(aged.data.now.humidity)}%</dd></div>
      <div><dt>wiatr</dt><dd>{round(aged.data.now.windSpeed)} {aged.data.units.windSpeed}</dd></div>
    </dl>
    {#if strip.length > 0 && !presenting && !manual}
      <!-- The next full hours: hour, temperature, chance of precipitation.
           Absent, not empty, when there is no hourly data (an answer cached
           before the series existed): the card then renders as it always did. -->
      <dl class="hours" aria-label="prognoza godzinowa">
        {#each strip as cell (cell.hour)}
          <div>
            <dt>{cell.hour}</dt>
            <dd class="h-temp">{cell.temp}</dd>
            <dd class="h-pct" class:h-pct-zero={cell.pct === '0'}>{cell.pct === '--' ? '--' : `${cell.pct}%`}</dd>
          </div>
        {/each}
      </dl>
    {/if}
    <ul class="days">
      {#each forecast as d (d.date)}
        <li><span class="dow">{day(d.date)}</span><span class="range">{round(d.temperatureMin)} / {round(d.temperatureMax)}</span></li>
      {/each}
    </ul>
    {#if aged.stale}
      <!-- Not a decoration. The number above is old and looks current. -->
      <p class="stale">[!] dane sprzed {ageLabel(aged.ageSeconds)}</p>
    {/if}
  {/if}
  </div>
</Card>

<style>
  /* Found during k7-mobile-responsive's real-browser verification: the same
     missing-wrapper bug as K7AsciiArt.svelte had (Card.svelte's .card-body
     is not itself display:flex, so a squeezed cell — 6 cards on one page —
     let this card's own content spill past its boundary with no scroll
     affordance). Same fix, same established .wrap pattern. */
  .wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow-y: auto;
  }

  .msg { margin: 0; color: var(--fg-muted); }

  /* The drawing sits beside the figure, not above it: the temperature stays on
     the card's first line, where it is read from the doorway. Wraps below on a
     cell too narrow to hold both. */
  .now {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .art {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.1;
    white-space: pre;
    color: var(--fg-muted);
  }

  /* Glance tier: this is the figure read from the doorway at three metres. */
  .glance {
    margin: 0;
    font-size: var(--glance-sm);
    line-height: 1.05;
    font-variant-numeric: tabular-nums;
    color: var(--fg);
  }
  .unit { font-size: var(--text-lg); color: var(--fg-muted); }

  .cond { margin: 0 0 var(--space-2); color: var(--fg-muted); font-size: var(--text-sm); }

  .detail { display: flex; gap: var(--space-4); margin: 0 0 var(--space-2); flex-wrap: wrap; }
  .detail div { display: flex; flex-direction: column; }
  dt {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--fg-muted);
  }
  dd { margin: 0; font-size: var(--text-sm); font-variant-numeric: tabular-nums; }

  .days { list-style: none; margin: 0; padding: 0; display: flex; gap: var(--space-4); }
  .days li { display: flex; flex-direction: column; }
  .dow {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--fg-muted);
  }
  .range { font-size: var(--text-sm); font-variant-numeric: tabular-nums; }

  /* The hourly strip (deck k7-weather-card, screen standard-card): the .days
     recipe one row up — hour in the dt label style, temperature and chance
     of precipitation in the dd value style. Equal columns that may shrink
     (DESIGN.md §6.1), six on the wall, four on a phone. Four are RENDERED
     there, not two of six hidden; the count comes from the same breakpoint in
     the script. */
  .hours {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: var(--space-2);
    margin: 0 0 var(--space-2);
  }
  .hours div { display: flex; flex-direction: column; min-width: 0; }
  .h-temp { color: var(--fg); }
  .h-pct { color: var(--fg); }
  /* A dry hour is the common case; it should not shout as loudly as a wet one. */
  .h-pct-zero { color: var(--fg-muted); }
  @media (max-width: 767px) {
    .hours { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  }

  .stale { margin: var(--space-2) 0 0; color: var(--warn); font-size: var(--text-sm); }

  /* --- Slideshow presentation ----------------------------------------------
   * Read from the doorway with nobody in the room, so the same centred,
   * glance-tier shape as the clock (K7Card.svelte, which explains why this is
   * keyed on `-presenting` and not on `.k7-fullscreen-active`). The
   * temperature takes the top of the glance scale; everything else steps up
   * from the meta sizes a grid cell needs to the read tier's upper end.
   *
   * Centred with auto margins, not `justify-content`/`align-items: center`:
   * the Slideshow is in the shared layout.yaml, so a phone presents this too,
   * and centred content that does not fit spills past BOTH edges of a box
   * that cannot scroll — the start of the temperature was cut off at 375px.
   * Auto margins collapse to zero on overflow, so at worst the end is lost,
   * never the start. (`safe center` would say this directly; Safari 15.4+.) */
  :host(.k7-slideshow-presenting) .wrap {
    gap: var(--space-8);
    text-align: center;
    overflow: hidden;
  }
  :host(.k7-slideshow-presenting) .now { justify-content: center; gap: var(--space-8); }
  :host(.k7-slideshow-presenting) .art { font-size: var(--text-xl); }
  :host(.k7-slideshow-presenting) .readout { text-align: left; }
  :host(.k7-slideshow-presenting) .glance { font-size: var(--glance-lg); }
  :host(.k7-slideshow-presenting) .unit { font-size: var(--glance-sm); }
  :host(.k7-slideshow-presenting) .cond { margin: 0; font-size: var(--text-xl); }
  :host(.k7-slideshow-presenting) .detail { justify-content: center; gap: var(--space-12); margin-top: 0; margin-bottom: 0; }
  :host(.k7-slideshow-presenting) .detail div,
  :host(.k7-slideshow-presenting) .days li { align-items: center; }
  :host(.k7-slideshow-presenting) dt,
  :host(.k7-slideshow-presenting) .dow { font-size: var(--text-base); }
  :host(.k7-slideshow-presenting) dd,
  :host(.k7-slideshow-presenting) .range { font-size: var(--text-xl); }
  :host(.k7-slideshow-presenting) .days { justify-content: center; flex-wrap: wrap; gap: var(--space-6) var(--space-12); }
  :host(.k7-slideshow-presenting) .stale { margin-top: 0; font-size: var(--text-lg); }
  /* Last, so they win the margin ties with the per-element rules above. */
  :host(.k7-slideshow-presenting) .wrap > * { margin-left: auto; margin-right: auto; }
  :host(.k7-slideshow-presenting) .wrap > :first-child { margin-top: auto; }
  :host(.k7-slideshow-presenting) .wrap > :last-child { margin-bottom: auto; }

  /* A phone is held at arm's length, not read from the doorway (DESIGN.md
     §4.2's glanceable floor is for the wall), and the wall's sizes do not fit
     it: a 112px figure beside its art is wider than 375px. One step down
     the same scales, at the same breakpoint the rest of the app uses. */
  @media (max-width: 767px) {
    :host(.k7-slideshow-presenting) .wrap { gap: var(--space-4); }
    :host(.k7-slideshow-presenting) .now { gap: var(--space-4); }
    :host(.k7-slideshow-presenting) .art { font-size: var(--text-sm); }
    :host(.k7-slideshow-presenting) .glance { font-size: var(--glance-md); }
    :host(.k7-slideshow-presenting) .unit { font-size: var(--text-xl); }
    :host(.k7-slideshow-presenting) .cond { font-size: var(--text-lg); }
    :host(.k7-slideshow-presenting) .detail { gap: var(--space-6); }
    :host(.k7-slideshow-presenting) dt,
    :host(.k7-slideshow-presenting) .dow { font-size: var(--text-xs); }
    :host(.k7-slideshow-presenting) dd,
    :host(.k7-slideshow-presenting) .range { font-size: var(--text-lg); }
    :host(.k7-slideshow-presenting) .days { gap: var(--space-2) var(--space-6); }
    :host(.k7-slideshow-presenting) .stale { font-size: var(--text-base); }
  }
</style>
