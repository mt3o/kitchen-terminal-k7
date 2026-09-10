<!--
  comic-of-the-day.

  Third-party content pulled from an RSS/Atom feed — attribution and a link
  back to the source are part of the contract, not decoration, which is why
  this stays a separate card type from K7AsciiArt.svelte rather than a shared
  "image card" abstraction that would blur the legal distinction.
-->
<svelte:options customElement={{ tag: 'k7-comic' }} />

<script lang="ts">
  import Card from './Card.svelte'

  interface Props {
    rssUrl: string
    itemSelector?: string
    /** Comma-separated; matched case-insensitively against title/description. */
    filterKeywords?: string
    cacheDurationHours?: string
    maxWidthPx?: string
    linkToSource?: string
    creditText?: string
    /** Shown when the feed fetch fails and nothing is cached yet. */
    fallbackImageUrl?: string
    label?: string
  }

  let {
    rssUrl,
    itemSelector = '',
    filterKeywords = '',
    cacheDurationHours = '24',
    maxWidthPx = '380',
    linkToSource = 'true',
    creditText = '',
    fallbackImageUrl = '',
    label = 'KOMIKS.DNIA',
  }: Props = $props()

  interface Aged {
    ageSeconds: number
    stale: boolean
    source: string
    data: { imageUrl: string; sourceUrl?: string; title?: string }
  }

  let aged = $state<Aged | undefined>(undefined)
  let failed = $state(false)

  let cardState = $derived(failed && !aged ? 'fail' : !aged ? 'idle' : aged.stale ? 'warn' : 'ok')
  let meta = $derived(aged?.data.title ?? '')
  let showLink = $derived(linkToSource !== 'false')
  let widthPx = $derived(Number(maxWidthPx) || 380)

  async function load(signal: AbortSignal): Promise<void> {
    try {
      const q = (v: string): string => encodeURIComponent(v)
      let url = `/api/comic?rssUrl=${q(rssUrl)}&cacheDurationHours=${q(cacheDurationHours)}`
      if (itemSelector) url += `&itemSelector=${q(itemSelector)}`
      if (filterKeywords) url += `&filterKeywords=${q(filterKeywords)}`
      const res = await fetch(url, { signal })
      if (!res.ok) throw new Error(`comic ${res.status}`)
      aged = (await res.json()) as Aged
      failed = false
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      // Keep whatever image is already on screen — a household still sees
      // yesterday's comic rather than a blank card on one failed refresh.
      failed = true
    }
  }

  $effect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    // Daily content: check roughly every couple of hours rather than on a
    // weather-grade timer.
    const every = Math.max(3600, Number(cacheDurationHours || 24) * 1800) * 1000
    const timer = setInterval(() => void load(controller.signal), every)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  })
</script>

<Card label={label} meta={meta} state={cardState as 'ok' | 'warn' | 'fail' | 'idle'}>
  <div class="wrap">
    {#if failed && !aged}
      {#if fallbackImageUrl}
        <div class="frame">
          <img class="comic" style:max-width="{widthPx}px" src={fallbackImageUrl} alt="komiks dnia (zapasowy)" />
        </div>
      {:else}
        <p class="msg">brak komiksu</p>
      {/if}
    {:else if !aged}
      <p class="msg">wczytywanie</p>
    {:else}
      <div class="frame">
        <img class="comic" style:max-width="{widthPx}px" src={aged.data.imageUrl} alt={aged.data.title ?? 'komiks dnia'} loading="lazy" />
      </div>
      {#if creditText}
        {#if showLink && aged.data.sourceUrl}
          <a class="credit" href={aged.data.sourceUrl} target="_blank" rel="noreferrer">{creditText}</a>
        {:else}
          <p class="credit">{creditText}</p>
        {/if}
      {/if}
      {#if aged.stale}
        <p class="stale">[!] dane sprzed {Math.round(aged.ageSeconds / 3600)}h</p>
      {/if}
    {/if}
  </div>
</Card>

<style>
  /* Without an explicit block display, Safari leaves the host's height
     indefinite inside its CSS Grid cell, so the height:100% chain below
     (.wrap -> .frame -> .comic's max-height:100%) has nothing to resolve
     against and the clamp is silently dropped — the comic then renders at
     its natural size, overlapping the card above and below it. */
  :host {
    display: block;
    height: 100%;
  }

  /* Centers the comic (plus its credit/staleness lines) as a group in the
     card body, rather than the image sitting flush top-left whenever the
     card is taller or wider than the capped `maxWidthPx` image. */
  .wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 0;
    text-align: center;
  }

  .msg { margin: 0; color: var(--fg-muted); }

  /* Takes whatever vertical room the credit/staleness lines leave (flex: 1,
     not the image itself) so max-height below has a real box to shrink
     against, with padding as breathing room around the scaled-down image. */
  .frame {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-3);
  }

  /* max-width/max-height with width/height: auto is "shrink to fit, never
     enlarge" for a replaced element — the same effect `background-size:
     contain` gives a background image, for a plain <img>. */
  .comic {
    display: block;
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    object-fit: contain;
    border: var(--border-w) solid var(--border);
  }

  .credit {
    display: block;
    margin: var(--space-2) 0 0;
    font-size: var(--text-xs);
    color: var(--fg-muted);
    text-decoration: none;
  }
  a.credit:hover { color: var(--fg); }

  .stale { margin: var(--space-2) 0 0; color: var(--warn); font-size: var(--text-sm); }
</style>
