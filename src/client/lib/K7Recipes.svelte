<!--
  Recipes card. Ships as a custom element (k7-recipes) wrapping the shared
  <Card> shell, following K7ShoppingList's established conventions: no
  optimistic updates, server-confirmed rows only.

  Import is a two-step, review-before-save flow at the HTTP layer, not just in
  this component: POST /api/recipes/import only extracts and returns what it
  found, nothing is written to SQLite until the household edits/approves it
  through POST /api/recipes here. A card must not present placeholder data as
  real, and this card must not persist a guess as if it had been reviewed.

  The chat card's /przepis lands in the same review form: it broadcasts a
  draft (lib/k7-events.ts), this card opens it and asks main.ts to bring it
  on screen. A draft from a model gets no shortcut past review.

  Tapping a title opens the recipe itself — ingredients, steps (durations in
  them start the timer card), and EDYTUJ, which reuses the review form with
  the recipe's id so ZAPISZ overwrites that file rather than adding a copy.
-->
<svelte:options customElement={{
  tag: 'k7-recipes',
  props: {
    maxVisible: { type: 'String', reflect: true },
    allowUrlImport: { type: 'String', reflect: true },
    tags: { type: 'String', reflect: true },
  },
}} />

<script lang="ts">
  import Card from './Card.svelte'
  import { formatDuration, linkDurations } from './chat-commands.ts'
  import { RECIPE_DRAFT, requestReveal, requestTimerStart, type RecipeDraft, type RecipeDraftDetail } from './k7-events.ts'
  import { escapeHtml } from './markdown.ts'

  interface Recipe {
    id: string
    title: string
    sourceUrl: string | null
    ingredients: string[]
    steps: string[]
    tags: string[]
    importedAt: string
  }

  interface Props {
    maxVisible?: string
    allowUrlImport?: string
    /** Comma-separated filter list. Empty = all, matching the schema's own field. */
    tags?: string
  }

  let { maxVisible = '6', allowUrlImport = 'true', tags = '' }: Props = $props()

  let limit = $derived(Math.max(1, Number(maxVisible) || 6))
  let importEnabled = $derived(allowUrlImport !== 'false')
  let filterTag = $derived(tags.split(',').map((t) => t.trim()).filter(Boolean)[0])

  let items = $state<Recipe[]>([])
  let loading = $state(true)
  let failed = $state(false)
  let pendingIds = $state<Set<string>>(new Set())

  type Mode = 'list' | 'review' | 'detail'
  let mode = $state<Mode>('list')
  let detail = $state<Recipe | undefined>(undefined)
  let timerNote = $state('')
  let importUrl = $state('')
  let importing = $state(false)
  let importError = $state('')

  // Review-state fields, pre-filled from the extraction and freely editable —
  // this is the actual review step, not a confirmation dialog over read-only text.
  let reviewSourceUrl = $state<string | null>(null)
  /** Empty for a new recipe; an existing one's id when EDYTUJ opened the form. */
  let reviewId = $state('')
  let reviewFromChat = $state(false)
  let reviewTitle = $state('')
  let reviewIngredients = $state('')
  let reviewSteps = $state('')
  let reviewTags = $state('')
  let saving = $state(false)
  let saveError = $state('')

  let cardState = $derived<'ok' | 'fail' | 'idle'>(failed ? 'fail' : loading ? 'idle' : 'ok')
  let meta = $derived(`${items.length} ${przepisy(items.length)}`)

  function przepisy(n: number): string {
    if (n === 1) return 'przepis'
    const mod10 = n % 10
    const mod100 = n % 100
    if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'przepisy'
    return 'przepisow'
  }

  const linesOf = (s: string): string[] => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const tagsOf = (s: string): string[] => s.split(',').map((t) => t.trim()).filter(Boolean)

  let controller: AbortController | undefined

  async function load(): Promise<void> {
    controller?.abort()
    const ac = new AbortController()
    controller = ac
    loading = true
    try {
      // Built by hand rather than with URLSearchParams, matching K7Weather's
      // convention — this file's ESLint browser-globals allowlist is
      // hand-maintained and does not (yet) include it.
      const query = `limit=${encodeURIComponent(limit)}${filterTag ? `&tag=${encodeURIComponent(filterTag)}` : ''}`
      const res = await fetch(`/api/recipes?${query}`, { signal: ac.signal })
      if (!res.ok) throw new Error(`recipes ${res.status}`)
      items = (await res.json()) as Recipe[]
      failed = false
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      failed = true
    } finally {
      if (controller === ac) loading = false
    }
  }

  async function removeRecipe(recipe: Recipe): Promise<void> {
    if (pendingIds.has(recipe.id)) return
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    pendingIds = new Set(pendingIds).add(recipe.id)
    try {
      // Ids are file names now, and a hand-made file may be `Pierogi ruskie`.
      const res = await fetch(`/api/recipes/${encodeURIComponent(recipe.id)}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) throw new Error(`delete ${res.status}`)
      items = items.filter((i) => i.id !== recipe.id)
      failed = false
    } catch {
      failed = true
    } finally {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const next = new Set(pendingIds)
      next.delete(recipe.id)
      pendingIds = next
    }
  }

  function openReview(recipe: RecipeDraft, options: { id?: string; fromChat?: boolean } = {}): void {
    reviewId = options.id ?? ''
    reviewFromChat = options.fromChat ?? false
    reviewSourceUrl = recipe.sourceUrl
    reviewTitle = recipe.title
    reviewIngredients = recipe.ingredients.join('\n')
    reviewSteps = recipe.steps.join('\n')
    reviewTags = recipe.tags.join(', ')
    saveError = ''
    mode = 'review'
  }

  async function startImport(): Promise<void> {
    const url = importUrl.trim()
    if (!url || importing) return
    importing = true
    importError = ''
    try {
      const res = await fetch('/api/recipes/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const body = (await res.json()) as
        | { title: string; sourceUrl: string | null; ingredients: string[]; steps: string[]; tags: string[] }
        | { error: string; reason?: string }
      if (!res.ok || 'error' in body) {
        importError = 'error' in body ? body.error : `import ${res.status}`
        return
      }
      // Nothing has been saved yet — the extraction only opens the review step.
      openReview(body)
      importUrl = ''
    } catch {
      importError = 'nie udalo sie polaczyc z serwerem'
    } finally {
      importing = false
    }
  }

  function openManualEntry(): void {
    openReview({ sourceUrl: null, title: '', ingredients: [], steps: [], tags: [] })
  }

  async function saveReview(): Promise<void> {
    const title = reviewTitle.trim()
    if (!title || saving) return
    saving = true
    saveError = ''
    try {
      const res = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(reviewId ? { id: reviewId } : {}),
          title,
          sourceUrl: reviewSourceUrl,
          ingredients: linesOf(reviewIngredients),
          steps: linesOf(reviewSteps),
          tags: tagsOf(reviewTags),
        }),
      })
      if (!res.ok) throw new Error(`save ${res.status}`)
      const saved = (await res.json()) as Recipe
      if (reviewId) {
        detail = saved
        mode = 'detail'
      } else {
        mode = 'list'
      }
      await load()
    } catch {
      saveError = 'nie udalo sie zapisac przepisu'
    } finally {
      saving = false
    }
  }

  function cancelReview(): void {
    // Nothing was ever persisted — an extraction that is not confirmed here
    // simply never reaches the database.
    mode = reviewId && detail ? 'detail' : 'list'
    saveError = ''
  }

  function openDetail(recipe: Recipe): void {
    detail = recipe
    timerNote = ''
    mode = 'detail'
  }

  function editDetail(): void {
    if (detail) openReview(detail, { id: detail.id })
  }

  /** Delegated from the steps list: the duration buttons are generated HTML, not Svelte nodes. */
  function onStepsClick(e: MouseEvent): void {
    const button = (e.target as HTMLElement).closest('button.dur')
    const seconds = Number(button?.getAttribute('data-seconds'))
    if (!button || !Number.isFinite(seconds) || seconds <= 0) return
    const result = requestTimerStart(seconds)
    timerNote =
      result === 'started'
        ? `[OK] minutnik: ${formatDuration(seconds)}`
        : result === 'busy'
          ? '[!] minutnik juz odlicza — zatrzymaj go najpierw'
          : '[!] brak minutnika w ukladzie'
  }

  // The chat's /przepis. Refused while a review is already open: a draft
  // must never silently replace edits the household is in the middle of.
  $effect(() => {
    const host = $host()
    const onDraft = (e: Event): void => {
      const request = (e as CustomEvent<RecipeDraftDetail>).detail
      if (request.result === 'opened') return
      if (mode === 'review') {
        request.result = 'busy'
        return
      }
      openReview(request.draft, { fromChat: true })
      request.result = 'opened'
      requestReveal(host)
    }
    window.addEventListener(RECIPE_DRAFT, onDraft)
    return () => window.removeEventListener(RECIPE_DRAFT, onDraft)
  })

  $effect(() => {
    void limit
    void filterTag
    void load()
    return () => controller?.abort()
  })
</script>

<Card label="BAZA.PRZEPISY" {meta} state={mode === 'list' ? cardState : 'idle'} fullscreen>
  {#if mode === 'review'}
    <form class="review" onsubmit={(e) => { e.preventDefault(); void saveReview() }}>
      {#if reviewSourceUrl}
        <p class="review-source">zrodlo: {reviewSourceUrl}</p>
      {:else if reviewFromChat}
        <p class="review-source">zrodlo: czat ai // sprawdz przed zapisem</p>
      {/if}
      <label class="field">
        <span class="field-label">tytul</span>
        <input class="field-input" type="text" bind:value={reviewTitle} maxlength="200" required />
      </label>
      <label class="field">
        <span class="field-label">skladniki (jedna linia = jeden skladnik)</span>
        <textarea class="field-area" bind:value={reviewIngredients} rows="4"></textarea>
      </label>
      <label class="field">
        <span class="field-label">kroki (jedna linia = jeden krok)</span>
        <textarea class="field-area" bind:value={reviewSteps} rows="4"></textarea>
      </label>
      <label class="field">
        <span class="field-label">tagi (po przecinku)</span>
        <input class="field-input" type="text" bind:value={reviewTags} maxlength="200" />
      </label>
      {#if saveError}<p class="error">[!] {saveError}</p>{/if}
      <div class="review-actions">
        <button type="button" class="btn-ghost" onclick={cancelReview} disabled={saving}>ANULUJ</button>
        <button type="submit" class="btn-solid" disabled={saving || reviewTitle.trim() === ''}>ZAPISZ</button>
      </div>
    </form>
  {:else if mode === 'detail' && detail}
    <div class="detail">
      <p class="detail-title">{detail.title}</p>
      {#if detail.tags.length > 0}<p class="chips">{detail.tags.join(', ')}</p>{/if}
      {#if detail.sourceUrl}<p class="review-source">zrodlo: {detail.sourceUrl}</p>{/if}
      <p class="field-label">skladniki</p>
      {#if detail.ingredients.length > 0}
        <ul class="detail-list">
          {#each detail.ingredients as item, i (i)}<li>{item}</li>{/each}
        </ul>
      {:else}
        <p class="empty">brak</p>
      {/if}
      <p class="field-label">kroki</p>
      {#if detail.steps.length > 0}
        <!-- The click lands on generated <button class="dur"> elements, which are
             keyboard-operable on their own; the list only delegates. -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
        <ol class="detail-list" onclick={onStepsClick}>
          {#each detail.steps as step, i (i)}
            <!-- escapeHtml runs before linkDurations adds its own tags (see chat-commands.ts). -->
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <li>{@html linkDurations(escapeHtml(step))}</li>
          {/each}
        </ol>
      {:else}
        <p class="empty">brak</p>
      {/if}
      {#if timerNote}<p class="note">{timerNote}</p>{/if}
      <div class="review-actions">
        <button type="button" class="btn-ghost" onclick={() => { mode = 'list' }}>WSTECZ</button>
        <button type="button" class="btn-ghost" onclick={editDetail}>EDYTUJ</button>
      </div>
    </div>
  {:else}
    <div class="wrap">
      <div class="list" role="list">
        {#if loading && items.length === 0}
          <p class="empty">wczytywanie</p>
        {:else if items.length === 0}
          <p class="empty">brak przepisow</p>
        {:else}
          {#each items as recipe (recipe.id)}
            <div class="row-wrap">
              <button type="button" class="row" onclick={() => openDetail(recipe)}>
                <span class="title">{recipe.title}</span>
                {#if recipe.tags.length > 0}
                  <span class="chips">{recipe.tags.join(', ')}</span>
                {/if}
              </button>
              <button
                type="button"
                class="row-delete"
                disabled={pendingIds.has(recipe.id)}
                aria-label={`usun ${recipe.title}`}
                onclick={() => removeRecipe(recipe)}
              >
                &times;
              </button>
            </div>
          {/each}
        {/if}
      </div>

      {#if importEnabled}
        <form class="import" onsubmit={(e) => { e.preventDefault(); void startImport() }}>
          <input
            class="import-url"
            type="url"
            placeholder="adres URL przepisu"
            bind:value={importUrl}
            disabled={importing}
          />
          <button type="submit" class="btn-ghost" disabled={importing || importUrl.trim() === ''}>
            {importing ? 'IMPORTUJE' : 'IMPORTUJ'}
          </button>
          <button type="button" class="btn-ghost" onclick={openManualEntry} disabled={importing}>
            + RECZNIE
          </button>
        </form>
        {#if importError}<p class="error">[!] {importError}</p>{/if}
      {/if}
    </div>
  {/if}
</Card>

<style>
  /* The scroll lives on .wrap, not on .list alone — same fix as
     K7ShoppingList.svelte's .wrap and K7Timer.svelte's .idle-wrap
     (k7-mobile-responsive): .import's own natural height (URL field, two
     buttons) had no shrink/scroll escape hatch once .list gave up all its
     slack, and the RECZNIE button spilled past the card boundary. */
  .wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    gap: var(--space-3);
    overflow-y: auto;
  }

  /* Natural size, NOT flex:1 1 auto/min-height:0: a real-browser
     desktop-width check caught that letting .list shrink while it has no
     overflow-clipping of its own let its overflowing rows spill visually
     past its shrunk box and collide with .import's text below it. Rendering
     .list at its natural height and letting .wrap's overflow-y:auto reveal
     the excess via scroll avoids the overlap entirely. */
  .list {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
  }

  .empty {
    margin: 0;
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }

  .row-wrap {
    display: flex;
    align-items: stretch;
    gap: var(--space-2);
    border-bottom: var(--border-w) solid var(--border);
  }

  .row-wrap:last-child { border-bottom: none; }

  .row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: var(--space-1);
    flex: 1 1 auto;
    min-width: 0;
    min-height: var(--control-h-sm);
    padding: var(--space-2) var(--space-2);
    background: transparent;
    border: none;
    color: var(--fg);
    font-family: var(--font-ui);
    text-align: left;
    cursor: pointer;
  }
  .row:hover { background: var(--ghost-hover); }
  .row:active { background: var(--ghost-active); }
  .row:focus {
    outline: var(--focus-w) solid var(--focus);
    outline-offset: calc(var(--focus-offset) * -1);
  }
  @supports selector(:focus-visible) {
    .row:focus:not(:focus-visible) { outline: none; }
  }

  .title {
    color: var(--fg);
    font-size: var(--text-base);
    overflow-wrap: anywhere;
  }

  .chips {
    color: var(--fg-muted);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }

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

  .row-delete:hover { background: var(--ghost-hover); color: var(--fg); }
  .row-delete:active { background: var(--ghost-active); }
  .row-delete:disabled { cursor: not-allowed; color: var(--fg-disabled); }

  .row-delete:focus {
    outline: var(--focus-w) solid var(--focus);
    outline-offset: calc(var(--focus-offset) * -1);
  }
  @supports selector(:focus-visible) {
    .row-delete:focus:not(:focus-visible) { outline: none; }
  }

  .import {
    flex: 0 0 auto;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    border-top: var(--border-w-strong) solid var(--border-strong);
    padding-top: var(--space-3);
  }

  .import-url {
    flex: 1 1 100%;
    min-width: 0;
    font-family: var(--font-ui);
    font-size: var(--text-base);
    color: var(--fg);
    background: var(--surface-sunken);
    border: var(--border-w) solid var(--border);
    border-radius: var(--radius);
    min-height: var(--control-h-sm);
    padding: 0 var(--space-3);
  }

  .import-url:focus {
    border-color: var(--border-strong);
    outline: var(--focus-w) solid var(--focus);
    outline-offset: var(--focus-offset);
  }

  .import-url::placeholder { color: var(--fg-muted); }

  .error {
    margin: 0;
    color: var(--fail);
    font-size: var(--text-sm);
  }

  /* Shared control look, reused between the import form and the review form.
     ZAPISZ is the only solid-amber control this card ever shows at once — the
     budget of at most one per card, spent deliberately on the save action. */
  .btn-ghost,
  .btn-solid {
    font-family: var(--font-ui);
    font-size: var(--text-base);
    font-weight: var(--weight-medium);
    min-height: var(--control-h-sm);
    padding: var(--space-2) var(--control-pad-x);
    border-radius: var(--radius);
    cursor: pointer;
  }

  .btn-ghost {
    border: var(--border-w) solid var(--border-strong);
    background: transparent;
    color: var(--fg);
  }
  .btn-ghost:hover { background: var(--ghost-hover); }
  .btn-ghost:active { background: var(--ghost-active); }

  .btn-solid {
    border: var(--border-w) solid transparent;
    background: var(--accent);
    color: var(--accent-fg);
  }
  .btn-solid:hover { background: var(--accent-hover); }
  .btn-solid:active { background: var(--accent-active); }

  .btn-ghost:disabled,
  .btn-solid:disabled {
    background: transparent;
    border-color: var(--border);
    color: var(--fg-disabled);
    cursor: not-allowed;
  }

  .btn-ghost:focus,
  .btn-solid:focus {
    outline: var(--focus-w) solid var(--focus);
    outline-offset: var(--focus-offset);
  }
  @supports selector(:focus-visible) {
    .btn-ghost:focus:not(:focus-visible),
    .btn-solid:focus:not(:focus-visible) { outline: none; }
  }

  .review {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    gap: var(--space-2);
    overflow-y: auto;
  }

  .review-source {
    margin: 0;
    color: var(--fg-muted);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .field-label {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--fg-muted);
  }

  .field-input,
  .field-area {
    font-family: var(--font-ui);
    font-size: var(--text-base);
    color: var(--fg);
    background: var(--surface-sunken);
    border: var(--border-w) solid var(--border);
    border-radius: var(--radius);
    padding: var(--space-2) var(--space-3);
  }

  .field-input { min-height: var(--control-h-sm); }
  .field-area { resize: vertical; }

  .field-input:focus,
  .field-area:focus {
    border-color: var(--border-strong);
    outline: var(--focus-w) solid var(--focus);
    outline-offset: var(--focus-offset);
  }

  .detail {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    gap: var(--space-2);
    overflow-y: auto;
  }

  .detail-title {
    margin: 0;
    color: var(--fg);
    font-size: var(--text-lg);
    font-weight: var(--weight-medium);
    overflow-wrap: anywhere;
  }

  .detail-list {
    margin: 0;
    padding-left: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-base);
    overflow-wrap: anywhere;
  }

  .note {
    margin: 0;
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }

  /* Durations inside a step, generated by linkDurations — a text-rank button
     (DESIGN.md §8): dashed underline, no fill, raises contrast on hover. */
  .detail-list :global(button.dur) {
    padding: 0 var(--space-1);
    background: transparent;
    border: none;
    border-bottom: var(--border-w) dashed var(--border-strong);
    border-radius: var(--radius);
    color: var(--fg);
    font-family: var(--font-ui);
    font-size: inherit;
    cursor: pointer;
  }
  .detail-list :global(button.dur:hover) { background: var(--ghost-hover); }
  .detail-list :global(button.dur:active) { background: var(--ghost-active); }

  .review-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding-top: var(--space-2);
    border-top: var(--border-w-strong) solid var(--border-strong);
  }
</style>
