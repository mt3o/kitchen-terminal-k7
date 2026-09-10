<!--
  image: a single static picture from a configured URL. No fetch, no polling,
  no daily rotation — that is exactly what tells it apart from
  ascii-art-of-the-day (AI-generated, own prompt/model) and comic-of-the-day
  (RSS-fed, dated, attributed). Both of those change on a schedule; this one
  is fixed until the layout itself is edited, so the browser's own <img>
  loading is the whole implementation — no upstream_cache row, no server
  round-trip beyond the image request itself.

  An "image carousel" needs no dedicated component: the existing carousel
  card (K7Carousel.svelte) already renders arbitrary nested cards one at a
  time, so a carousel whose slides are all `type: image` cards already is
  one — see layout.yaml's `karuzela-zdjecia` for a worked example.
-->
<svelte:options customElement={{ tag: 'k7-image' }} />

<script lang="ts">
  import Card from './Card.svelte'

  interface Props {
    url: string
    altText?: string
    /** Shown under the image, same role as comic-of-the-day's creditText. */
    caption?: string
    /** Optional click-through, same shape as comic-of-the-day's linkToSource. */
    linkUrl?: string
    maxWidthPx?: string
    label?: string
  }

  let { url, altText = '', caption = '', linkUrl = '', maxWidthPx = '', label = 'OBRAZ' }: Props = $props()

  type LoadState = 'idle' | 'ok' | 'fail'
  let state = $state<LoadState>('idle')
  // Reset if the layout swaps the URL live rather than sticking with
  // whatever the previous image's load/error already decided.
  $effect(() => {
    void url
    state = 'idle'
  })

  let cardState = $derived<'ok' | 'fail' | 'idle'>(state)
  let widthPx = $derived(maxWidthPx ? Number(maxWidthPx) || undefined : undefined)
  let resolvedAlt = $derived(altText || caption || 'obraz')
</script>

<Card label={label} state={cardState}>
  <div class="wrap">
    {#if state === 'fail'}
      <p class="msg">[!] nie udało się wczytać obrazu</p>
    {:else}
      <div class="frame">
        {#if linkUrl}
          <a href={linkUrl} target="_blank" rel="noreferrer">
            <img
              class="pic"
              style:max-width={widthPx ? `${widthPx}px` : undefined}
              src={url}
              alt={resolvedAlt}
              loading="lazy"
              onload={() => (state = 'ok')}
              onerror={() => (state = 'fail')}
            />
          </a>
        {:else}
          <img
            class="pic"
            style:max-width={widthPx ? `${widthPx}px` : undefined}
            src={url}
            alt={resolvedAlt}
            loading="lazy"
            onload={() => (state = 'ok')}
            onerror={() => (state = 'fail')}
          />
        {/if}
      </div>
      {#if caption}
        <p class="caption">{caption}</p>
      {/if}
    {/if}
  </div>
</Card>

<style>
  /* Same centering/scaling discipline as K7Comic.svelte's .wrap/.frame/.comic
     — shrink to fit, never enlarge, centered as a group with the caption. */
  .wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 0;
    text-align: center;
  }

  .msg { margin: 0; color: var(--warn); font-size: var(--text-sm); }

  .frame {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-3);
  }

  .pic {
    display: block;
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    object-fit: contain;
    border: var(--border-w) solid var(--border);
  }

  .caption {
    margin: var(--space-2) 0 0;
    font-size: var(--text-xs);
    color: var(--fg-muted);
  }
</style>
