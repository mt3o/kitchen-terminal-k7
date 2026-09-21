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
  import { MENU_SELECT, type MenuSelectDetail } from './k7-events.ts'

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

  // main.ts asking every menu to surface a card another card revealed
  // (lib/k7-events.ts) — only the menu that owns that card id acts on it.
  $effect(() => {
    const host = $host()
    const onSelect = (e: Event): void => {
      const { cardId } = (e as CustomEvent<MenuSelectDetail>).detail
      if (parsedItems.some((item) => item.cardId === cardId)) select(cardId)
    }
    host.addEventListener(MENU_SELECT, onSelect)
    return () => host.removeEventListener(MENU_SELECT, onSelect)
  })

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
  }
  /* One line, never `flex-wrap: wrap`: a multi-line flex container sizes
     each line to its widest item rather than to itself, so in the 1-of-3
     column PRZEPISY gives this menu at phone width every item came out as
     wide as "AUDIOMETR" (135px) in a 91px card body and was cut off by the
     card's `overflow: hidden`. A single-line column stretches its items to
     its own width. (Wrapping never bought a second column anyway: that
     needs a definite height, and this list has none.) */
  .orientation-vertical {
    flex-direction: column;
    align-items: stretch;
  }
  .orientation-horizontal {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
  }

  /* `max-width: 100%` caps a horizontal item, which is sized by its label,
     at the menu's width — a vertical one is already stretched to it. */
  .item {
    box-sizing: border-box;
    max-width: 100%;
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

  /* A label wider than its item breaks inside it — "AUDIOMETR" is ~100px of
     tracked text-sm, a 1-of-3 column at 390px leaves ~70px — rather than
     running out of the item and being cut off. Broken, every letter is
     still there; an ellipsis would hide the word the item is named for.
     `break-word`, not `anywhere` (Safari 15.4); it needs `min-width: 0` to
     act inside a flex item. Left-aligned so a two-line label lines up with
     the one-line ones instead of centring under a button's default. */
  .icon-tag,
  .label {
    min-width: 0;
    overflow-wrap: break-word;
    text-align: left;
  }

  /* Horizontal padding is what gives at phone width, as in K7Chat's head
     and composer buttons — min-height, the touch-target floor, does not. */
  @media (max-width: 767px) {
    .item {
      padding-left: var(--space-2);
      padding-right: var(--space-2);
    }
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
