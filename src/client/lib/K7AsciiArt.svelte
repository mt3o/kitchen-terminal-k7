<!--
  ascii-art-of-the-day.

  Own AI-generated content — no attribution, no copyright exposure, kept
  separate from K7Comic.svelte on purpose (see comic-of-the-day, which pulls
  third-party content and carries legal weight this one does not). The seed
  is shown in the meta line because the whole point of storing it is being
  able to reproduce a result while debugging a prompt.
-->
<svelte:options customElement={{ tag: 'k7-ascii-art' }} />

<script lang="ts">
  import Card from './Card.svelte'

  interface Props {
    prompt: string
    model?: string
    /** How often a fresh generation is asked for, "cached for the day" by default. */
    cacheDurationHours?: string
    maxWidthChars?: string
    maxHeightLines?: string
    colorized?: string
    /** Reuse a prior seed to reproduce its result; otherwise the server mints one. */
    seed?: string
    /** Shown when generation fails and nothing is cached yet. */
    fallbackArt?: string
    label?: string
  }

  let {
    prompt,
    model = 'kilo-auto/free',
    cacheDurationHours = '24',
    maxWidthChars = '60',
    maxHeightLines = '24',
    colorized = 'true',
    seed,
    fallbackArt = '',
    label = 'ASCII.DNIA',
  }: Props = $props()

  interface Aged {
    ageSeconds: number
    stale: boolean
    source: string
    data: { art: string; seed: number; model: string; prompt: string }
  }

  let aged = $state<Aged | undefined>(undefined)
  let failed = $state(false)

  let cardState = $derived(failed && !aged ? 'fail' : !aged ? 'idle' : aged.stale ? 'warn' : 'ok')
  let meta = $derived(aged ? `ziarno: ${aged.data.seed}` : '')
  let isColorized = $derived(colorized !== 'false')

  async function load(signal: AbortSignal): Promise<void> {
    try {
      const q = (v: string): string => encodeURIComponent(v)
      let url =
        `/api/ascii-art?prompt=${q(prompt)}&model=${q(model)}&cacheDurationHours=${q(cacheDurationHours)}` +
        `&maxWidthChars=${q(maxWidthChars)}&maxHeightLines=${q(maxHeightLines)}`
      if (seed !== undefined && seed !== '') url += `&seed=${q(seed)}`
      const res = await fetch(url, { signal })
      if (!res.ok) throw new Error(`ascii-art ${res.status}`)
      aged = (await res.json()) as Aged
      failed = false
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      // Keep whatever art is already on screen. One failed refresh should not
      // blank a card that generated fine yesterday.
      failed = true
    }
  }

  $effect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    // Once a day is the natural cadence for a once-a-day generation; refresh
    // slightly more often than the cache window so the new art appears
    // promptly once it exists, without hammering the gateway.
    const every = Math.max(3600, Number(cacheDurationHours || 24) * 1800) * 1000
    const timer = setInterval(() => void load(controller.signal), every)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  })
</script>

<Card label={label} meta={meta} state={cardState as 'ok' | 'warn' | 'fail' | 'idle'}>
  {#if failed && !aged}
    {#if fallbackArt}
      <pre class="art fallback">{fallbackArt}</pre>
    {:else}
      <p class="msg">brak ascii-art</p>
    {/if}
  {:else if !aged}
    <p class="msg">generowanie</p>
  {:else}
    <pre class="art" class:muted={!isColorized}>{aged.data.art}</pre>
    {#if aged.stale}
      <p class="stale">[!] dane sprzed {Math.round(aged.ageSeconds / 3600)}h</p>
    {/if}
  {/if}
</Card>

<style>
  .msg { margin: 0; color: var(--fg-muted); }

  .art {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.15;
    color: var(--fg);
    white-space: pre;
    overflow: auto;
  }
  .art.muted { color: var(--fg-muted); }
  .art.fallback { color: var(--fg-muted); }

  .stale { margin: var(--space-2) 0 0; color: var(--warn); font-size: var(--text-sm); }
</style>
