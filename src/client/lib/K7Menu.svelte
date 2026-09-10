<!--
  MENU — the `menu` card type: a switcher that picks which of several OTHER
  cards is active, without rendering their content itself (layout.schema.yaml
  params.menu). This component only knows its own items; it dispatches a
  bubbling+composed CustomEvent and leaves the actual show/hide coordination
  to `main.ts`, which alone has the full `items` list from `card.params` and
  can reach every card by id across the whole document (all pages coexist in
  the DOM at once — the pager only translates between them).

  `icon` (a Tabler outline icon name) is accepted per item but rendered as
  plain label text: no Tabler icon asset pipeline exists anywhere in this
  repo yet (the not-yet-built sidebar's `toggleIcon` has the same gap). Not
  silently faked — flagged in the PR as deferred, real icons come later.
-->
<svelte:options
  customElement={{
    tag: 'k7-menu',
    props: {
      items: { reflect: true },
      orientation: { reflect: true },
      style: { reflect: true },
      defaultActive: { reflect: true }
    }
  }}
/>

<script lang="ts">
  import Card from './Card.svelte'

  interface MenuItem {
    cardId: string
    label: string
    icon?: string
  }

  interface Props {
    /** JSON-encoded MenuItem[] — custom-element attrs are strings. */
    items?: string
    orientation?: 'horizontal' | 'vertical'
    style?: 'tabs' | 'icons' | 'list'
    defaultActive?: string
  }

  let { items = '[]', orientation = 'vertical', style = 'icons', defaultActive = '' }: Props = $props()

  let parsedItems = $derived.by((): MenuItem[] => {
    try {
      const parsed = JSON.parse(items) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed.filter(
        (it): it is MenuItem => typeof it === 'object' && it !== null && typeof (it as MenuItem).cardId === 'string',
      )
    } catch {
      return []
    }
  })

  let active = $state('')
  let initialised = false

  function resolveInitial(): string {
    return defaultActive || parsedItems[0]?.cardId || ''
  }

  function dispatchChange(cardId: string): void {
    $host().dispatchEvent(new CustomEvent('k7-menu-change', { detail: { cardId }, bubbles: true, composed: true }))
  }

  function select(cardId: string): void {
    if (cardId === active) return
    active = cardId
    dispatchChange(active)
  }

  $effect(() => {
    // Applies once, as soon as the item list is known — main.ts has exactly
    // one code path (the event listener) for "apply the active selection",
    // used for both this initial paint and every later click.
    if (initialised || parsedItems.length === 0) return
    initialised = true
    active = resolveInitial()
    dispatchChange(active)
  })
</script>

<Card label="MENU" state="ok">
  <nav class="items orientation-{orientation} style-{style}" aria-label="menu">
    {#each parsedItems as item (item.cardId)}
      <button
        type="button"
        class="item"
        class:is-active={item.cardId === active}
        aria-pressed={item.cardId === active}
        onclick={() => select(item.cardId)}
      >
        {#if item.icon}<span class="icon-tag" aria-hidden="true">[{item.icon}]</span>{/if}
        <span class="label">{item.label}</span>
      </button>
    {/each}
  </nav>
</Card>

<style>
  .items {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .orientation-vertical {
    flex-direction: column;
    align-items: stretch;
  }
  .orientation-horizontal {
    flex-direction: row;
    align-items: center;
  }

  .item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--control-h-sm);
    /* DESIGN.md §6: "buttons pad vertically" — min-height alone leaves a
       two-line label touching the border. */
    padding: var(--space-2) var(--control-pad-x);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--fg);
    background: transparent;
    border: var(--border-w-strong) solid var(--border-strong);
    border-radius: var(--radius);
    cursor: pointer;
    transition:
      background-color var(--motion-fast) var(--ease),
      color var(--motion-fast) var(--ease),
      border-color var(--motion-fast) var(--ease);
  }
  .item:hover {
    background: var(--ghost-hover);
    color: var(--fg);
  }
  .item:active {
    background: var(--ghost-active);
  }

  /* The active item is the one solid-amber control this card spends
     (DESIGN.md §2/§8: at most one per card). */
  .item.is-active {
    background: var(--accent);
    color: var(--accent-fg);
    border-color: var(--accent);
  }
  .item.is-active:hover {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  .icon-tag {
    font-size: var(--text-xs);
    color: inherit;
    opacity: 0.8;
  }

  .style-tabs.orientation-horizontal {
    border-bottom: var(--border-w) solid var(--border);
  }
  .style-tabs .item {
    border-radius: var(--radius);
    border-width: var(--border-w);
  }
  .style-tabs .item.is-active {
    border-bottom: var(--border-w-strong) solid var(--accent);
  }

  .item:focus {
    outline: var(--focus-w) solid var(--focus);
    outline-offset: var(--focus-offset);
  }
  @supports selector(:focus-visible) {
    .item:focus {
      outline: none;
    }
    .item:focus-visible {
      outline: var(--focus-w) solid var(--focus);
      outline-offset: var(--focus-offset);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .item {
      transition-duration: 0ms;
    }
  }
</style>
