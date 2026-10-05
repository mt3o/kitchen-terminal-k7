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
  import { hostIdOf, presentingElIdStore } from './fullscreen-lock.ts'
  import {
    DEFAULT_CELLS,
    fitCells,
    graphHeader,
    graphRows,
    hourLabel,
    shownSlice,
    upcomingHours,
    type GraphOptions,
    type WeatherHour,
  } from './weather-hourly.ts'
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
   * answer, and the presented graphs must still move past hours that have
   * gone by rather than freeze at the last successful refresh.
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
  let forecast = $derived(aged ? aged.data.daily.slice(1, presenting ? undefined : 4) : [])

  // --- hourly graphs, Slideshow presentation only (deck k7-weather-card) ---
  //
  // The standard card has no row to spare for hourly data ([node:d1f56964]),
  // so the graphs exist only while the Slideshow presents the card and owns
  // the screen. No hours (an answer cached before the series existed) means
  // no graph column at all: the presentation is then exactly the old one.
  let timeZone = $derived(aged?.data.timezone ?? 'Europe/Warsaw')
  let upcoming = $derived(upcomingHours(aged?.data.hourly, nowMs, 72))
  let hasHours = $derived(presenting && upcoming.length > 0)

  /**
   * Geometry is measured, never set per breakpoint ([node:e0d9cfb5]): one
   * rendered line of ten mono characters gives the cell width and the line
   * height in whatever face the theme uses, and the rows box — whose size
   * comes from the layout, never from its own text ([node:21b0b80b]) — says
   * how many of each fit. `lines` starts at 0 so nothing is painted before the
   * first measurement, rather than a guess that might be cut in half.
   */
  const MAX_LINES = 24
  let rowsEl = $state<HTMLElement | undefined>(undefined)
  let probeEl = $state<HTMLElement | undefined>(undefined)
  let fit = $state({ columns: 0, lines: 0 })
  $effect(() => {
    const box = rowsEl
    const probe = probeEl
    if (!box || !probe) return
    const measure = (): void => {
      const b = box.getBoundingClientRect()
      const p = probe.getBoundingClientRect()
      if (p.width <= 0 || p.height <= 0) return
      const columns = Math.floor(b.width / (p.width / 10))
      const lines = Math.min(MAX_LINES, Math.floor(b.height / p.height))
      // Only on change: an equal write would still re-render every row.
      if (columns !== fit.columns || lines !== fit.lines) fit = { columns, lines }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    return () => ro.disconnect()
  })

  let graphOpts = $derived.by((): GraphOptions => {
    const cells =
      fit.columns > 0
        ? fitCells(fit.columns, { showMm: true, showPct: true })
        : { tempCells: DEFAULT_CELLS, precipCells: DEFAULT_CELLS, showMm: false, showPct: true }
    return { timeZone, unit: aged?.data.units.precipitation ?? 'mm', ...cells, maxLines: Math.max(1, fit.lines) }
  })
  let shown = $derived(hasHours && fit.lines > 0 ? shownSlice(upcoming, graphOpts) : [])
  let rows = $derived(shown.length > 0 ? graphRows(upcoming, graphOpts) : [])
  let header = $derived(shown.length > 0 ? graphHeader(upcoming, { ...graphOpts, windowHours: shown.length }) : [])

  /** What the aria-hidden graphs say, as one sentence. */
  let summary = $derived.by((): string => {
    if (shown.length === 0) return ''
    const temps = shown.map((h) => h.temperature).filter((t): t is number => t !== null && Number.isFinite(t))
    const wet = shown.find((h) => (h.precipitation ?? 0) > 0)
    const range = temps.length > 0 ? `temperatura od ${Math.round(Math.min(...temps))} do ${Math.round(Math.max(...temps))} ${aged?.data.units.temperature ?? ''}` : 'brak temperatury'
    const rain = wet ? `pierwszy opad o ${hourLabel(Date.parse(wet.time), timeZone)}` : 'bez opadow'
    return `Prognoza godzinowa na ${shown.length} h: ${range}, ${rain}.`
  })

  /**
   * What gives way when the hero does not fit, by the deck's rulings:
   * stacked portrait with too few graph lines drops the detail row; side by
   * side in landscape, the hero drops the days row first ("days kept if they
   * fit"), then the detail row. Each drop is latched for the rest of the
   * presentation: dropping makes room, and deciding again from the roomier
   * layout would put the row straight back ([node:21b0b80b]).
   */
  const MIN_LINES_WITH_DETAIL = 8
  let heroEl = $state<HTMLElement | undefined>(undefined)
  let dropDays = $state(false)
  let portrait = $state(false)
  $effect(() => {
    const mq = window.matchMedia('(orientation: portrait)')
    const update = (): void => {
      portrait = mq.matches
    }
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  })
  let dropDetail = $state(false)
  $effect(() => {
    if (!presenting) {
      dropDetail = false
      dropDays = false
      return
    }
    if (hasHours && portrait && fit.lines > 0 && fit.lines < MIN_LINES_WITH_DETAIL) dropDetail = true
  })
  // Landscape: the hero has the column's full height, so a hero taller than
  // that is measurable as its own overflow. Decided once the box has settled
  // for a moment, and decided AGAIN whenever the box grows past the height a
  // drop was taken at. A promoted card spends its first second or so at the
  // deck's size, not the screen's (measured at 1024x768: the host is 992x626,
  // the hero 503 px, before it reaches 768 and 645), so a latch taken then
  // would keep dropping a row that fits. Only growth of the box un-drops, and
  // that comes from outside, never from the drop itself, so it cannot flip
  // back and forth ([node:21b0b80b]). Every drop re-checks, since a drop
  // changes the content, not the box.
  const SETTLE_MS = 500
  let droppedAtHeight = 0
  $effect(() => {
    void dropDays
    void dropDetail
    void forecast
    const el = heroEl
    if (!el || portrait || !hasHours) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = (): void => {
      if (el.scrollHeight <= el.clientHeight + 1) return
      droppedAtHeight = el.clientHeight
      if (!dropDays) dropDays = true
      else if (!dropDetail) dropDetail = true
    }
    const settle = (): void => {
      if ((dropDays || dropDetail) && el.clientHeight > droppedAtHeight + 1) {
        dropDays = false
        dropDetail = false
      }
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(check, SETTLE_MS)
    }
    settle()
    const ro = new ResizeObserver(settle)
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (timer !== undefined) clearTimeout(timer)
    }
  })

  const round = (n: number): string => (Number.isFinite(n) ? String(Math.round(n)) : '--')
  const day = (iso: string): string =>
    new Date(iso).toLocaleDateString('pl-PL', { weekday: 'short' }).replace('.', '')
</script>

{#snippet hero(a: Aged)}
  <div class="now">
    {#if artEnabled && art}
      <!-- Decorative: the temperature and the label beside it already say
           everything this draws, so a screen reader gets nothing new here. -->
      <pre class="art" aria-hidden="true">{art}</pre>
    {/if}
    <div class="readout">
      <p class="glance">{round(a.data.now.temperature)}<span class="unit">{a.data.units.temperature}</span></p>
      <p class="cond">{describeWeather(a.data.now.weatherCode)}</p>
    </div>
  </div>
  {#if !dropDetail}
    <dl class="detail">
      <div><dt>odczuwalna</dt><dd>{round(a.data.now.apparentTemperature)}{a.data.units.temperature}</dd></div>
      <div><dt>wilgotnosc</dt><dd>{round(a.data.now.humidity)}%</dd></div>
      <div><dt>wiatr</dt><dd>{round(a.data.now.windSpeed)} {a.data.units.windSpeed}</dd></div>
    </dl>
  {/if}
  {#if !dropDays}
    <ul class="days">
      {#each forecast as d (d.date)}
        <li><span class="dow">{day(d.date)}</span><span class="range">{round(d.temperatureMin)} / {round(d.temperatureMax)}</span></li>
      {/each}
    </ul>
  {/if}
  {#if a.stale}
    <!-- Not a decoration. The number above is old and looks current. -->
    <p class="stale">[!] dane sprzed {ageLabel(a.ageSeconds)}</p>
  {/if}
{/snippet}

<Card label={label} meta={meta} state={cardState as 'ok' | 'warn' | 'fail' | 'idle'}>
  <div class="wrap" class:has-hours={hasHours} bind:this={wrapEl}>
  {#if failed && !aged}
    <p class="msg">brak danych pogodowych</p>
  {:else if !aged}
    <p class="msg">odczyt</p>
  {:else if hasHours}
    <div class="hero" bind:this={heroEl}>{@render hero(aged)}</div>
    <div class="graphs">
      <!-- Text drawn by weather-hourly.ts: 7-bit ASCII, one span per role,
           coloured by token. Hidden from screen readers, which get the
           sentence below instead of 24 lines of bars. -->
      <div class="g-text g-head" aria-hidden="true">
        {#each header as line, i (i)}<div class="g-line">{#each line as seg, j (j)}<span class="r-{seg.role}">{seg.text}</span>{/each}</div>{/each}
      </div>
      <div class="g-rows" bind:this={rowsEl}>
        <div class="g-text" aria-hidden="true">
          {#each rows as line, i (i)}<div class="g-line">{#each line as seg, j (j)}<span class="r-{seg.role}">{seg.text}</span>{/each}</div>{/each}
        </div>
        <!-- The ruler: ten characters on one line, measured for cell width and
             line height in whatever mono face the theme uses. -->
        <div class="g-text g-line g-probe" aria-hidden="true" bind:this={probeEl}>0000000000</div>
      </div>
      <p class="g-summary">{summary}</p>
    </div>
  {:else}
    {@render hero(aged)}
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

  /* --- Slideshow presentation with hourly graphs ----------------------------
   * Deck k7-weather-card, screens slideshow-presenting(-phone). Everything
   * here is scoped under `.has-hours`, which only exists while presenting
   * WITH hours, so a presentation without hourly data is exactly the one
   * above (test/weather-presenting-fit.test.ts pins it).
   *
   * Orientation picks the arrangement, width picks the size step
   * ([node:7f4027ac]): landscape puts the hero and the graphs side by side,
   * portrait stacks them; below 767px everything is one notch down.
   *
   * The graph rows box takes its size from the layout — `flex: 1 1 0`,
   * `min-height: 0`, no auto margins — never from its rows, or measuring how
   * many rows fit would lock at a wrong count ([node:21b0b80b]). Inside the
   * hero, centring is auto margins again, never `align-items: center`, so a
   * hero too wide for its column loses its end and never its start
   * ([node:32f913e8]). */
  :host(.k7-slideshow-presenting) .wrap.has-hours { text-align: left; }
  :host(.k7-slideshow-presenting) .wrap.has-hours > .hero {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    flex: 0 0 auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    margin: 0;
    text-align: center;
  }
  :host(.k7-slideshow-presenting) .hero > * { margin-left: auto; margin-right: auto; }
  :host(.k7-slideshow-presenting) .wrap.has-hours > .graphs {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    margin: 0;
  }
  @media (orientation: landscape) {
    :host(.k7-slideshow-presenting) .wrap.has-hours { flex-direction: row; }
    /* Half and half, not the wireframe's 5:7: measured at 1024x768, a
       5/12 column (~400px) cannot hold the wall-size art beside the 112px
       figure, so the hero stacked and ran ~125px past the card. At half
       width it sits on one line; the graphs drop only the mm figure, which
       the bar already carries. */
    :host(.k7-slideshow-presenting) .wrap.has-hours > .hero { flex: 1 1 0; }
    :host(.k7-slideshow-presenting) .wrap.has-hours > .graphs { flex: 1 1 0; }
    /* Sharing the width with the graphs, the hero tightens what is not read
       from the doorway: the drawing one step down, the detail row closer.
       The temperature, condition and values keep their wall sizes. */
    :host(.k7-slideshow-presenting) .wrap.has-hours .art { font-size: var(--text-lg); }
    :host(.k7-slideshow-presenting) .wrap.has-hours .detail { gap: var(--space-6); }
    /* Three wall-size days at the --space-12 gap need ~498px; the half
       column has ~490, so the third day wrapped and the row stopped fitting. */
    :host(.k7-slideshow-presenting) .wrap.has-hours .days { gap: var(--space-6) var(--space-8); }
    /* Vertically centred in its column, by auto margins. */
    :host(.k7-slideshow-presenting) .hero > :first-child { margin-top: auto; }
    :host(.k7-slideshow-presenting) .hero > :last-child { margin-bottom: auto; }
  }

  .g-rows {
    position: relative;
    flex: 1 1 0;
    min-height: 0;
    overflow: hidden;
  }
  .g-text {
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    line-height: var(--leading-tight);
    color: var(--fg-muted);
  }
  .g-line { white-space: pre; }
  .g-probe { position: absolute; top: 0; left: 0; visibility: hidden; }
  .g-head { flex: 0 0 auto; }

  /* One token per role ([node:eab9ac6c]). Rain and snow already differ by
     glyph (# and *); colour only reinforces it. No --signal (teal is the
     state colour, rationed per card) and no --warn (that means a state). */
  .r-hour, .r-separator, .r-pct { color: var(--fg-muted); }
  .r-marker { color: var(--accent); }
  .r-value, .r-rain { color: var(--fg); }
  .r-snow { color: var(--fg-muted); }
  .r-muted { color: var(--fg-disabled); }

  /* The graphs' sentence for screen readers: present in the accessibility
     tree, not on the wall. */
  .g-summary {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: 0;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  @media (max-width: 767px) {
    .g-text { font-size: var(--text-sm); }
    :host(.k7-slideshow-presenting) .wrap.has-hours > .hero { gap: var(--space-3); }
    /* The landscape hero rules above out-rank the phone step for these two. */
    :host(.k7-slideshow-presenting) .wrap.has-hours .art { font-size: var(--text-sm); }
    :host(.k7-slideshow-presenting) .wrap.has-hours .detail { gap: var(--space-4); }
  }
</style>
