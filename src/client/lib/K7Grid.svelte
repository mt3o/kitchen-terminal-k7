<!--
  SIATKA — the `grid` card type (CardGrid in the domain model): a container Card
  with its own mini-grid inside it, where every cell is visible at once. In
  contrast to `carousel`, which pages through its slides one at a time.

  Cells are ordinary Cards, built by `main.ts`'s `createWidget` and appended as
  light-DOM children of this element — this component only lays them out via a
  shadow-DOM <slot>, it never constructs a card itself. That is what makes
  nesting (a grid cell that is itself a carousel, or another grid) work for
  free: the recursion lives entirely in `createWidget`, not here.
-->
<svelte:options
  customElement={{
    tag: 'k7-grid',
    props: {
      columns: { reflect: true },
      gap: { reflect: true }
    }
  }}
/>

<script lang="ts">
  import Card from './Card.svelte'

  interface Props {
    /** Custom-element attrs are strings; parsed to an int, default 2 per the schema. */
    columns?: string
    /** A raw CSS length, e.g. "8px" — a runtime layout value like `--deck-cols`
     *  in main.ts, not a theme token, so it is set as an inline style rather
     *  than read from tokens.css. */
    gap?: string
  }

  let { columns = '2', gap = '8px' }: Props = $props()

  let columnCount = $derived(Math.max(1, parseInt(columns, 10) || 2))
</script>

<Card label="SIATKA" state="ok">
  <div class="cells" style:--cell-cols={columnCount} style:--cell-gap={gap}>
    <slot></slot>
  </div>
</Card>

<style>
  .cells {
    display: grid;
    grid-template-columns: repeat(var(--cell-cols, 2), minmax(0, 1fr));
    gap: var(--cell-gap, var(--space-2));
    height: 100%;
    min-height: 0;

    /* Custom properties inherit through the shadow boundary (K7Card.svelte's
       own comment), so overriding the card-shape tokens here reaches every
       nested cell's shadow DOM without either of them knowing about it. A
       cell gets a fraction of a page cell's room, not a whole one, so it
       needs a step down on padding/min-height/type scale — the clock's
       --glance-sm digits (48px) were wide enough to overflow a cell on
       their own before this.

       Only --text-base steps down (to the old --text-sm), not --text-sm
       itself: a custom property referencing another one declared on the
       same rule resolves against that rule's own cascaded value, not the
       pre-override one, so redefining --text-sm here too would collapse
       --text-base, --text-sm and --text-xs to the same size instead of
       shifting each down one tier. */
    --card-pad: var(--space-2);
    --card-min-h: 0;
    --glance-sm: var(--text-xl);
    --text-base: var(--text-sm);
  }

  /* Cells are arbitrary nested Cards — they must be free to shrink below
     their content's natural size (DESIGN.md §6.1: grid tracks must be able
     to shrink) and must not overflow this card's own frame. */
  ::slotted(*) {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
</style>
