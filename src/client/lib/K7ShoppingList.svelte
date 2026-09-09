<!--
  Shopping list card. Ships as a custom element (k7-shopping-list) wrapping the
  shared <Card> shell.

  No optimistic updates: a checkbox toggled before the server confirms it is
  worse than a slow checkbox, because two people edit this list from different
  devices at the same time on the kitchen wall.
-->
<svelte:options customElement={{
  tag: 'k7-shopping-list',
  props: {
    groupByCategory: { type: 'String', reflect: true },
    showCheckedItems: { type: 'String', reflect: true },
  },
}} />

<script lang="ts">
  import Card from './Card.svelte'

  interface ShoppingListItem {
    id: string
    label: string
    category: string | null
    checked: boolean
    createdAt: string
    updatedAt: string
  }

  interface Props {
    groupByCategory?: string
    showCheckedItems?: string
  }

  let { groupByCategory = 'true', showCheckedItems = 'false' }: Props = $props()

  let groupEnabled = $derived(groupByCategory !== 'false')
  let showChecked = $derived(showCheckedItems === 'true')

  let items = $state<ShoppingListItem[]>([])
  let loading = $state(true)
  let failed = $state(false)
  let newLabel = $state('')
  let newCategory = $state('')
  let pendingIds = $state<Set<string>>(new Set())
  let submitting = $state(false)

  const UNCATEGORISED = 'bez kategorii'

  // Not named `state`: `$foo` is Svelte's store-subscription syntax, so a local
  // `state` turns every `$state(...)` rune in this file into a subscription to
  // it, and the errors point at the runes rather than at the name.
  let cardState = $derived<'ok' | 'fail' | 'idle'>(failed ? 'fail' : loading ? 'idle' : 'ok')
  let meta = $derived(`${items.length} ${pozycje(items.length)}`)

  function pozycje(n: number): string {
    if (n === 1) return 'pozycja'
    const mod10 = n % 10
    const mod100 = n % 100
    if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'pozycje'
    return 'pozycji'
  }

  interface Group {
    category: string
    items: ShoppingListItem[]
  }

  let groups = $derived.by<Group[]>(() => {
    if (!groupEnabled) return [{ category: '', items }]
    // A local grouping helper inside a derivation, never stored as state, so a
    // reactive Map would buy nothing and cost an import.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const byCategory = new Map<string, ShoppingListItem[]>()
    for (const item of items) {
      const key = item.category ?? UNCATEGORISED
      const bucket = byCategory.get(key)
      if (bucket) bucket.push(item)
      else byCategory.set(key, [item])
    }
    const named = [...byCategory.entries()]
      .filter(([category]) => category !== UNCATEGORISED)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, list]) => ({ category, items: list }))
    const rest = byCategory.get(UNCATEGORISED)
    return rest ? [...named, { category: UNCATEGORISED, items: rest }] : named
  })

  let controller: AbortController | undefined

  async function load(): Promise<void> {
    controller?.abort()
    const ac = new AbortController()
    controller = ac
    loading = true
    try {
      const url = showChecked ? '/api/shopping-list?checked=all' : '/api/shopping-list'
      const res = await fetch(url, { signal: ac.signal })
      if (!res.ok) throw new Error(`shopping-list ${res.status}`)
      const data = (await res.json()) as ShoppingListItem[]
      items = data
      failed = false
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      failed = true
    } finally {
      if (controller === ac) loading = false
    }
  }

  async function toggle(item: ShoppingListItem): Promise<void> {
    if (pendingIds.has(item.id)) return
    // Reassigned, not mutated — which is precisely how a plain Set works with
    // $state. SvelteSet exists for in-place mutation, which this is not.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    pendingIds = new Set(pendingIds).add(item.id)
    const nextChecked = !item.checked
    try {
      const res = await fetch(`/api/shopping-list/${item.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ checked: nextChecked }),
      })
      if (!res.ok) throw new Error(`toggle ${res.status}`)
      const updated = (await res.json()) as ShoppingListItem
      // Server-confirmed only: the row reflects what the server holds, never
      // what was tapped.
      items = items.map((i) => (i.id === updated.id ? updated : i))
      if (updated.checked && !showChecked) {
        items = items.filter((i) => i.id !== updated.id)
      }
      failed = false
    } catch {
      // Nothing to revert — the row was never changed optimistically — but the
      // card must say the write did not land.
      failed = true
    } finally {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const next = new Set(pendingIds)
      next.delete(item.id)
      pendingIds = next
    }
  }

  async function addItem(): Promise<void> {
    const label = newLabel.trim()
    if (!label || submitting) return
    submitting = true
    try {
      const category = newCategory.trim()
      const res = await fetch('/api/shopping-list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label, category: category === '' ? null : category }),
      })
      if (!res.ok) throw new Error(`add ${res.status}`)
      const created = (await res.json()) as ShoppingListItem
      items = [...items, created]
      newLabel = ''
      newCategory = ''
      failed = false
    } catch {
      failed = true
    } finally {
      submitting = false
    }
  }

  function onSubmit(e: SubmitEvent): void {
    e.preventDefault()
    void addItem()
  }

  async function removeItem(item: ShoppingListItem): Promise<void> {
    if (pendingIds.has(item.id)) return
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    pendingIds = new Set(pendingIds).add(item.id)
    try {
      const res = await fetch(`/api/shopping-list/${item.id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) throw new Error(`delete ${res.status}`)
      // Server-confirmed only, same as toggle(): the row leaves the list
      // because the server said the row is gone, not because the tap happened.
      // A 404 is treated as success too — someone else already deleted it from
      // another device, and the end state the household cares about is the
      // same either way.
      items = items.filter((i) => i.id !== item.id)
      failed = false
    } catch {
      failed = true
    } finally {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const next = new Set(pendingIds)
      next.delete(item.id)
      pendingIds = next
    }
  }

  $effect(() => {
    // Re-fetch whenever showChecked changes; groupEnabled is a pure
    // client-side reshaping of what is already loaded.
    void showChecked
    void load()
    return () => controller?.abort()
  })
</script>

<Card label="LISTA.ZAKUPY" {meta} state={cardState}>
  <div class="wrap">
    <div class="list" role="list">
      {#if loading && items.length === 0}
        <p class="empty">wczytywanie</p>
      {:else if items.length === 0}
        <p class="empty">lista pusta</p>
      {:else}
        {#each groups as group (group.category)}
          {#if groupEnabled && group.items.length > 0}
            <p class="cat-label">{group.category || UNCATEGORISED}</p>
          {/if}
          {#each group.items as item (item.id)}
            <div class="row-wrap">
              <button
                type="button"
                class="row"
                class:row-checked={item.checked}
                disabled={pendingIds.has(item.id)}
                aria-pressed={item.checked}
                onclick={() => toggle(item)}
              >
                <span class="glyph">{item.checked ? '[x]' : '[ ]'}</span>
                <span class="label">{item.label}</span>
              </button>
              <button
                type="button"
                class="row-delete"
                disabled={pendingIds.has(item.id)}
                aria-label={`usun ${item.label}`}
                onclick={() => removeItem(item)}
              >
                &times;
              </button>
            </div>
          {/each}
        {/each}
      {/if}
    </div>

    <form class="add" onsubmit={onSubmit}>
      <input
        class="add-label"
        type="text"
        placeholder="nowa pozycja"
        bind:value={newLabel}
        maxlength="200"
      />
      <input
        class="add-category"
        type="text"
        placeholder="kategoria"
        bind:value={newCategory}
        maxlength="80"
      />
      <button type="submit" class="add-btn" disabled={submitting || newLabel.trim() === ''}>
        + DODAJ
      </button>
    </form>
  </div>
</Card>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    gap: var(--space-3);
  }

  .list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .empty {
    margin: 0;
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }

  .cat-label {
    margin: 0;
    padding: var(--space-2) 0 var(--space-1);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--fg-muted);
  }

  .row-wrap {
    display: flex;
    align-items: stretch;
    border-bottom: var(--border-w) solid var(--border);
  }

  .row-wrap:last-child { border-bottom: none; }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex: 1 1 auto;
    min-width: 0;
    min-height: var(--control-h-sm);
    padding: var(--space-2) var(--space-2);
    border: none;
    background: transparent;
    color: var(--fg);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    text-align: left;
    cursor: pointer;
  }

  .row:hover {
    background: var(--ghost-hover);
    color: var(--fg);
  }

  .row:active { background: var(--ghost-active); }

  .row-delete {
    flex: 0 0 auto;
    min-width: var(--control-h-sm);
    min-height: var(--control-h-sm);
    border: none;
    background: transparent;
    color: var(--fg-muted);
    font-family: var(--font-ui);
    font-size: var(--text-lg);
    line-height: 1;
    cursor: pointer;
  }

  .row-delete:hover {
    background: var(--ghost-hover);
    color: var(--fg);
  }

  .row-delete:active { background: var(--ghost-active); }

  .row-delete:disabled {
    cursor: not-allowed;
    color: var(--fg-disabled);
  }

  .row:focus {
    outline: var(--focus-w) solid var(--focus);
    outline-offset: calc(var(--focus-offset) * -1);
  }
  @supports selector(:focus-visible) {
    .row:focus:not(:focus-visible) { outline: none; }
  }

  .row:disabled {
    cursor: not-allowed;
    color: var(--fg-disabled);
  }

  .row-delete:focus {
    outline: var(--focus-w) solid var(--focus);
    outline-offset: calc(var(--focus-offset) * -1);
  }
  @supports selector(:focus-visible) {
    .row-delete:focus:not(:focus-visible) { outline: none; }
  }

  .glyph {
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
    color: var(--fg-muted);
  }

  .row-checked .glyph { color: var(--signal); }

  .label {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .row-checked .label {
    color: var(--fg-muted);
    text-decoration: line-through;
  }

  .add {
    flex: 0 0 auto;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    border-top: var(--border-w-strong) solid var(--border-strong);
    padding-top: var(--space-3);
  }

  .add-label,
  .add-category {
    font-family: var(--font-ui);
    font-size: var(--text-base);
    color: var(--fg);
    background: var(--surface-sunken);
    border: var(--border-w) solid var(--border);
    border-radius: var(--radius);
    min-height: var(--control-h-sm);
    padding: 0 var(--space-3);
  }

  .add-label { flex: 1 1 60%; min-width: 0; }
  .add-category { flex: 1 1 30%; min-width: 0; }

  .add-label:focus,
  .add-category:focus {
    border-color: var(--border-strong);
    outline: var(--focus-w) solid var(--focus);
    outline-offset: var(--focus-offset);
  }

  .add-label::placeholder,
  .add-category::placeholder {
    color: var(--fg-muted);
  }

  .add-btn {
    flex: 1 1 100%;
    font-family: var(--font-ui);
    font-size: var(--text-base);
    font-weight: var(--weight-medium);
    min-height: var(--control-h-sm);
    padding: var(--space-2) var(--control-pad-x);
    border-radius: var(--radius);
    border: var(--border-w) solid transparent;
    background: var(--accent);
    color: var(--accent-fg);
    cursor: pointer;
  }

  .add-btn:hover { background: var(--accent-hover); }
  .add-btn:active { background: var(--accent-active); }

  .add-btn:focus {
    outline: var(--focus-w) solid var(--focus);
    outline-offset: var(--focus-offset);
  }
  @supports selector(:focus-visible) {
    .add-btn:focus:not(:focus-visible) { outline: none; }
  }

  .add-btn:disabled {
    background: transparent;
    border-color: var(--border);
    color: var(--fg-disabled);
    cursor: not-allowed;
  }
</style>
