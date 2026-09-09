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
  import { ageLabel, describeWeather, isSevere } from './wmo.ts'

  interface Props {
    lat?: string
    lon?: string
    units?: string
    label?: string
    /** Seconds between refreshes. The upstream updates about every 15 min. */
    refresh?: string
  }

  let { lat = '52.2297', lon = '21.0122', units = 'metric', label = 'SYS.POGODA', refresh = '900' }: Props = $props()

  interface Aged {
    ageSeconds: number
    stale: boolean
    source: string
    data: {
      units: { temperature: string; windSpeed: string }
      now: { temperature: number; apparentTemperature: number; humidity: number; windSpeed: number; weatherCode: number }
      daily: { date: string; weatherCode: number; temperatureMax: number; temperatureMin: number }[]
    }
  }

  let aged = $state<Aged | undefined>(undefined)
  let failed = $state(false)

  let cardState = $derived(
    failed ? 'fail' : !aged ? 'idle' : aged.stale || isSevere(aged.data.now.weatherCode) ? 'warn' : 'ok',
  )
  let meta = $derived(aged ? ageLabel(aged.ageSeconds) : '')

  async function load(signal: AbortSignal): Promise<void> {
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

  const round = (n: number): string => (Number.isFinite(n) ? String(Math.round(n)) : '--')
  const day = (iso: string): string =>
    new Date(iso).toLocaleDateString('pl-PL', { weekday: 'short' }).replace('.', '')
</script>

<Card label={label} meta={meta} state={cardState as 'ok' | 'warn' | 'fail' | 'idle'}>
  {#if failed && !aged}
    <p class="msg">brak danych pogodowych</p>
  {:else if !aged}
    <p class="msg">odczyt</p>
  {:else}
    <p class="glance">{round(aged.data.now.temperature)}<span class="unit">{aged.data.units.temperature}</span></p>
    <p class="cond">{describeWeather(aged.data.now.weatherCode)}</p>
    <dl class="detail">
      <div><dt>odczuwalna</dt><dd>{round(aged.data.now.apparentTemperature)}{aged.data.units.temperature}</dd></div>
      <div><dt>wilgotnosc</dt><dd>{round(aged.data.now.humidity)}%</dd></div>
      <div><dt>wiatr</dt><dd>{round(aged.data.now.windSpeed)} {aged.data.units.windSpeed}</dd></div>
    </dl>
    <ul class="days">
      {#each aged.data.daily.slice(1, 4) as d (d.date)}
        <li><span class="dow">{day(d.date)}</span><span class="range">{round(d.temperatureMin)} / {round(d.temperatureMax)}</span></li>
      {/each}
    </ul>
    {#if aged.stale}
      <!-- Not a decoration. The number above is old and looks current. -->
      <p class="stale">[!] dane sprzed {ageLabel(aged.ageSeconds)}</p>
    {/if}
  {/if}
</Card>

<style>
  .msg { margin: 0; color: var(--fg-muted); }

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
</style>
