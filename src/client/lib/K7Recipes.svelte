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

  The list holds every saved recipe, as summaries (title, tags) from
  GET /api/recipes?view=summary, a page at a time: a sentinel row at the end
  of the list loads the next page as it scrolls into view. The search field
  above it sends `q`: the server matches title, tags, ingredients, steps,
  description and source URL, ranked in that order. Under it, the most common
  tags of the current result are chips; tapping one narrows the list to
  recipes carrying it (ANDed with the search). The full recipe is
  fetched only when one is opened. maxVisible no longer caps anything.
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
  import { isHttpUrl } from '../../shared/url.ts'
  import { ageLabel } from './wmo.ts'

  interface Recipe {
    id: string
    title: string
    description: string
    sourceUrl: string | null
    ingredients: string[]
    steps: string[]
    tags: string[]
    importedAt: string
  }

  /** A list row: what GET /api/recipes?view=summary returns per recipe. */
  type RecipeSummary = Pick<Recipe, 'id' | 'title' | 'tags' | 'importedAt'>

  /** A failed add/import attempt the household can review and retry — see
   *  server/domain/types.ts's RecipeRejection for the full shape. */
  interface RecipeRejection {
    id: string
    kind: 'save' | 'import'
    reason: string
    attemptedInput: Record<string, unknown>
    createdAt: string
  }

  interface Props {
    /** Accepted for existing layouts; the list is no longer capped. */
    maxVisible?: string
    allowUrlImport?: string
    /** Comma-separated filter list. Empty = all, matching the schema's own field. */
    tags?: string
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept so layouts that set it still bind
  let { maxVisible = '6', allowUrlImport = 'true', tags = '' }: Props = $props()

  let importEnabled = $derived(allowUrlImport !== 'false')
  let filterTag = $derived(tags.split(',').map((t) => t.trim()).filter(Boolean)[0])

  /** Rows per request — enough to fill a fullscreen card at the read tier. */
  const PAGE_SIZE = 30

  let items = $state<RecipeSummary[]>([])
  let total = $state(0)
  /** From the last page served; null once the list is complete. */
  let nextCursor = $state<string | null>(null)
  let loadingMore = $state(false)
  let moreFailed = $state(false)
  let scroller = $state<HTMLDivElement | undefined>(undefined)
  let sentinel = $state<HTMLDivElement | undefined>(undefined)
  const canObserve = typeof IntersectionObserver !== 'undefined'

  /** What is typed; `searchQuery` follows it after a pause, and is what load() sends. */
  let searchInput = $state('')
  let searchQuery = $state('')
  const SEARCH_DEBOUNCE_MS = 250

  interface TagFacet {
    tag: string
    count: number
  }
  let tagFacets = $state<TagFacet[]>([])
  let selectedTags = $state<string[]>([])

  // Native overflow-x scrolls the chip row; this only stops its swipe from
  // also being read as a page-level gesture — same as K7Calendar's tab strip.
  function stopFacetsPropagation(e: TouchEvent): void {
    e.stopPropagation()
  }

  function toggleTag(tag: string): void {
    selectedTags = selectedTags.includes(tag) ? selectedTags.filter((t) => t !== tag) : [...selectedTags, tag]
  }
  let loading = $state(true)
  let failed = $state(false)
  let pendingIds = $state<Set<string>>(new Set())

  let rejections = $state<RecipeRejection[]>([])
  let pendingRejectionIds = $state<Set<string>>(new Set())

  type Mode = 'list' | 'review' | 'detail' | 'rejections'
  let mode = $state<Mode>('list')
  let detail = $state<Recipe | undefined>(undefined)
  /** The summary tapped, while its full recipe is still being fetched. */
  let detailPending = $state<RecipeSummary | undefined>(undefined)
  let detailError = $state('')
  let detailController: AbortController | undefined
  let timerNote = $state('')
  let importUrl = $state('')
  let importing = $state(false)
  let importError = $state('')

  // Review-state fields, pre-filled from the extraction and freely editable —
  // this is the actual review step, not a confirmation dialog over read-only text.
  /** Empty string is "no source" — matches the server's empty-means-clear convention. */
  let reviewSourceUrl = $state('')
  /** Empty for a new recipe; an existing one's id when EDYTUJ opened the form. */
  let reviewId = $state('')
  let reviewFromChat = $state(false)
  let reviewTitle = $state('')
  let reviewDescription = $state('')
  let reviewIngredients = $state('')
  let reviewSteps = $state('')
  let reviewTags = $state('')
  let saving = $state(false)
  let saveError = $state('')

  let cardState = $derived<'ok' | 'fail' | 'idle'>(failed ? 'fail' : loading ? 'idle' : 'ok')
  let meta = $derived(`${total} ${przepisy(total)}`)

  function rejectionAgeSeconds(iso: string): number {
    const then = new Date(iso).getTime()
    if (Number.isNaN(then)) return 0
    return Math.max(0, Math.round((Date.now() - then) / 1000))
  }

  /** The one field worth showing per kind — a title if there was one to
   *  reject, the attempted URL if the import never got that far. */
  function rejectionLabel(rejection: RecipeRejection): string {
    const value = rejection.kind === 'save' ? rejection.attemptedInput.title : rejection.attemptedInput.url
    return typeof value === 'string' && value.trim() !== '' ? value : rejection.kind === 'save' ? '(bez tytulu)' : '(brak adresu)'
  }

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
    loadingMore = false
    moreFailed = false
    try {
      const res = await fetch(`/api/recipes?${pageQuery()}`, { signal: ac.signal })
      if (!res.ok) throw new Error(`recipes ${res.status}`)
      const page = (await res.json()) as CatalogPage
      items = page.items
      total = page.total
      nextCursor = page.nextCursor
      tagFacets = page.tagFacets
      failed = false
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      // Not the previous query's rows under the new search text, and not its
      // cursor either — loadMore() would page the new query from it.
      items = []
      total = 0
      nextCursor = null
      tagFacets = []
      failed = true
    } finally {
      if (controller === ac) loading = false
    }
  }

  interface CatalogPage {
    items: RecipeSummary[]
    total: number
    nextCursor: string | null
    tagFacets: TagFacet[]
  }

  function pageQuery(cursor?: string): string {
    // Built by hand rather than with URLSearchParams, matching K7Weather's
    // convention.
    let query = `view=summary&limit=${PAGE_SIZE}`
    if (filterTag) query += `&tag=${encodeURIComponent(filterTag)}`
    if (searchQuery) query += `&q=${encodeURIComponent(searchQuery)}`
    if (selectedTags.length > 0) query += `&tags=${encodeURIComponent(selectedTags.join(','))}`
    if (cursor) query += `&cursor=${encodeURIComponent(cursor)}`
    return query
  }

  /** The next page, appended. A reload (load()) aborts it via `controller`. */
  async function loadMore(): Promise<void> {
    if (!nextCursor || loadingMore || loading) return
    const ac = controller
    loadingMore = true
    moreFailed = false
    try {
      const res = await fetch(`/api/recipes?${pageQuery(nextCursor)}`, { signal: ac?.signal })
      if (!res.ok) throw new Error(`recipes ${res.status}`)
      const page = (await res.json()) as CatalogPage
      if (ac !== controller) return
      const known = new Set(items.map((i) => i.id))
      items = [...items, ...page.items.filter((i) => !known.has(i.id))]
      total = page.total
      nextCursor = page.nextCursor
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      // The rows already shown stay; the sentinel offers a retry.
      moreFailed = true
    } finally {
      if (ac === controller) loadingMore = false
    }
  }

  async function loadRejections(): Promise<void> {
    try {
      const res = await fetch('/api/recipes/rejections')
      if (!res.ok) throw new Error(`rejections ${res.status}`)
      rejections = (await res.json()) as RecipeRejection[]
    } catch {
      // Secondary affordance — a failed fetch here must not block the main
      // recipe list, so this fails silently rather than setting `failed`.
    }
  }

  async function deleteRejection(rejection: RecipeRejection): Promise<void> {
    if (pendingRejectionIds.has(rejection.id)) return
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    pendingRejectionIds = new Set(pendingRejectionIds).add(rejection.id)
    try {
      const res = await fetch(`/api/recipes/rejections/${encodeURIComponent(rejection.id)}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) throw new Error(`delete ${res.status}`)
      rejections = rejections.filter((r) => r.id !== rejection.id)
    } catch {
      // Left in the list — the household can retry the delete.
    } finally {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const next = new Set(pendingRejectionIds)
      next.delete(rejection.id)
      pendingRejectionIds = next
    }
  }

  /** Best-effort coercion of a rejected attempt back into a RecipeDraft — the
   *  field that failed validation is, by definition, not guaranteed to be
   *  the right type, so each one falls back rather than throwing. */
  function toRecipeDraft(input: Record<string, unknown>): RecipeDraft {
    const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    return {
      title: typeof input.title === 'string' ? input.title : '',
      description: typeof input.description === 'string' ? input.description : '',
      sourceUrl: typeof input.sourceUrl === 'string' ? input.sourceUrl : null,
      ingredients: strings(input.ingredients),
      steps: strings(input.steps),
      tags: strings(input.tags),
    }
  }

  function retryRejection(rejection: RecipeRejection): void {
    if (rejection.kind === 'save') {
      const id = typeof rejection.attemptedInput.id === 'string' ? rejection.attemptedInput.id : undefined
      openReview(toRecipeDraft(rejection.attemptedInput), { id })
      return
    }
    // Nothing was ever extracted for an import rejection — no review form to
    // reopen, just refill the URL so IMPORTUJ is ready to press again.
    importUrl = typeof rejection.attemptedInput.url === 'string' ? rejection.attemptedInput.url : ''
    mode = 'list'
  }

  async function removeRecipe(recipe: RecipeSummary): Promise<void> {
    if (pendingIds.has(recipe.id)) return
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    pendingIds = new Set(pendingIds).add(recipe.id)
    try {
      // Ids are file names now, and a hand-made file may be `Pierogi ruskie`.
      const res = await fetch(`/api/recipes/${encodeURIComponent(recipe.id)}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) throw new Error(`delete ${res.status}`)
      items = items.filter((i) => i.id !== recipe.id)
      if (res.ok) {
        total = Math.max(0, total - 1)
        tagFacets = tagFacets
          .map((f) => (recipe.tags.includes(f.tag) ? { ...f, count: f.count - 1 } : f))
          .filter((f) => f.count > 0 || selectedTags.includes(f.tag))
      }
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
    reviewSourceUrl = recipe.sourceUrl ?? ''
    reviewTitle = recipe.title
    reviewDescription = recipe.description
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
        | { title: string; description: string; sourceUrl: string | null; ingredients: string[]; steps: string[]; tags: string[] }
        | { error: string; reason?: string }
      if (!res.ok || 'error' in body) {
        importError = 'error' in body ? body.error : `import ${res.status}`
        void loadRejections()
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
    openReview({ sourceUrl: null, title: '', description: '', ingredients: [], steps: [], tags: [] })
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
          description: reviewDescription.trim(),
          sourceUrl: reviewSourceUrl.trim(),
          ingredients: linesOf(reviewIngredients),
          steps: linesOf(reviewSteps),
          tags: tagsOf(reviewTags),
        }),
      })
      if (!res.ok) {
        // Surfaces the server's actual reason (e.g. a rejected sourceUrl
        // scheme) instead of a generic failure, same pattern startImport() uses.
        const body = (await res.json().catch(() => undefined)) as { error?: string } | undefined
        saveError = body?.error || `nie udalo sie zapisac przepisu (${res.status})`
        // The server just logged this as a rejection; NIEUDANE PROBY may not exist yet.
        void loadRejections()
        return
      }
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

  /** Where the list was scrolled when a recipe was opened; restored by WSTECZ. */
  let listScrollTop = 0
  let restoreScrollTop: number | undefined = undefined

  /** The list only has the summary; the recipe itself is read on open. */
  async function openDetail(summary: RecipeSummary): Promise<void> {
    // The list unmounts with its scroll container; with every recipe listed,
    // losing the position means scrolling back to row 85 by hand.
    listScrollTop = scroller?.scrollTop ?? 0
    detailController?.abort()
    const ac = new AbortController()
    detailController = ac
    detail = undefined
    detailPending = summary
    detailError = ''
    timerNote = ''
    mode = 'detail'
    try {
      const res = await fetch(`/api/recipes/${encodeURIComponent(summary.id)}`, { signal: ac.signal })
      if (!res.ok) throw new Error(res.status === 404 ? 'tego przepisu juz nie ma' : `przepis ${res.status}`)
      detail = (await res.json()) as Recipe
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      detailError = err instanceof Error && err.message.startsWith('tego') ? err.message : 'nie udalo sie wczytac przepisu'
    } finally {
      if (detailController === ac) detailPending = undefined
    }
  }

  function closeDetail(): void {
    detailController?.abort()
    detailPending = undefined
    detailError = ''
    restoreScrollTop = listScrollTop
    mode = 'list'
  }

  // Runs when the list's scroll container mounts again after WSTECZ.
  $effect(() => {
    if (!scroller || restoreScrollTop === undefined) return
    scroller.scrollTop = restoreScrollTop
    restoreScrollTop = undefined
  })

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

  // A request per pause in typing, not per keystroke.
  $effect(() => {
    const next = searchInput.trim()
    const timer = setTimeout(() => {
      searchQuery = next
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  })

  $effect(() => {
    void filterTag
    void searchQuery
    void selectedTags
    void load()
    return () => {
      controller?.abort()
      detailController?.abort()
    }
  })

  $effect(() => {
    void loadRejections()
  })

  // The next page is asked for while the sentinel is still 200px below the
  // fold, so it usually lands before the household reaches the bottom. An
  // observer, not a scroll listener: nothing runs per frame on the A8X.
  // Re-observed after every append: an observer only reports changes, so a
  // sentinel still in view after a short page would otherwise never fire again.
  $effect(() => {
    void items.length
    if (!canObserve || !sentinel || !scroller || moreFailed) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore()
      },
      { root: scroller, rootMargin: '0px 0px 200px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  })
</script>

<Card label="BAZA.PRZEPISY" {meta} state={mode === 'list' ? cardState : 'idle'} fullscreen>
  {#if mode === 'review'}
    <form class="review" onsubmit={(e) => { e.preventDefault(); void saveReview() }}>
      {#if reviewFromChat && !reviewSourceUrl}
        <p class="review-source">zrodlo: czat ai // sprawdz przed zapisem</p>
      {/if}
      <label class="field">
        <span class="field-label">tytul</span>
        <input class="field-input" type="text" bind:value={reviewTitle} maxlength="200" required />
      </label>
      <label class="field">
        <span class="field-label">opis (opcjonalnie)</span>
        <textarea class="field-area" bind:value={reviewDescription} rows="3"></textarea>
      </label>
      <label class="field">
        <span class="field-label">zrodlo (adres URL, opcjonalnie)</span>
        <input class="field-input" type="url" bind:value={reviewSourceUrl} maxlength="2000" placeholder="https://..." />
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
  {:else if mode === 'detail' && !detail}
    <div class="detail">
      <p class="detail-title">{detailPending?.title ?? ''}</p>
      {#if detailError}
        <p class="error">[!] {detailError}</p>
      {:else}
        <p class="empty">wczytywanie</p>
      {/if}
      <div class="review-actions">
        <button type="button" class="btn-ghost" onclick={closeDetail}>WSTECZ</button>
      </div>
    </div>
  {:else if mode === 'detail' && detail}
    <div class="detail">
      <p class="detail-title">{detail.title}</p>
      {#if detail.description}<p class="detail-description">{detail.description}</p>{/if}
      {#if detail.tags.length > 0}<p class="chips">{detail.tags.join(', ')}</p>{/if}
      {#if detail.sourceUrl && isHttpUrl(detail.sourceUrl)}
        <a class="review-source" href={detail.sourceUrl} target="_blank" rel="noopener noreferrer">zrodlo: {detail.sourceUrl}</a>
      {:else if detail.sourceUrl}
        <p class="review-source">zrodlo: {detail.sourceUrl}</p>
      {/if}
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
        <button type="button" class="btn-ghost" onclick={closeDetail}>WSTECZ</button>
        <button type="button" class="btn-ghost" onclick={editDetail}>EDYTUJ</button>
      </div>
    </div>
  {:else if mode === 'rejections'}
    <div class="wrap">
      <div class="list" role="list">
        {#if rejections.length === 0}
          <p class="empty">brak nieudanych prob</p>
        {:else}
          {#each rejections as rejection (rejection.id)}
            <div class="row-wrap">
              <div class="rejection-info">
                <span class="title">{rejectionLabel(rejection)}</span>
                <span class="chips">
                  {rejection.kind === 'save' ? 'zapis' : 'import'} // {rejection.reason} //
                  {ageLabel(rejectionAgeSeconds(rejection.createdAt))}
                </span>
              </div>
              <button type="button" class="btn-ghost" onclick={() => retryRejection(rejection)}>PONOW</button>
              <button
                type="button"
                class="row-delete"
                disabled={pendingRejectionIds.has(rejection.id)}
                aria-label={`usun nieudana probe: ${rejectionLabel(rejection)}`}
                onclick={() => deleteRejection(rejection)}
              >
                &times;
              </button>
            </div>
          {/each}
        {/if}
      </div>
      <div class="review-actions">
        <button type="button" class="btn-ghost" onclick={() => { mode = 'list' }}>WSTECZ</button>
      </div>
    </div>
  {:else}
    <div class="wrap" bind:this={scroller}>
      <input
        class="import-url search"
        type="search"
        placeholder="szukaj: tytul, tag, skladnik..."
        aria-label="szukaj przepisow"
        maxlength="200"
        bind:value={searchInput}
      />
      {#if tagFacets.length > 0}
        <div
          class="facets"
          role="group"
          aria-label="filtruj po tagach"
          ontouchstart={stopFacetsPropagation}
          ontouchmove={stopFacetsPropagation}
          ontouchend={stopFacetsPropagation}
        >
          {#each tagFacets as facet (facet.tag)}
            {@const on = selectedTags.includes(facet.tag)}
            <button
              type="button"
              class="facet"
              class:facet-on={on}
              aria-pressed={on}
              onclick={() => toggleTag(facet.tag)}
            >{on ? `[ ${facet.tag} ${facet.count} ]` : `${facet.tag} ${facet.count}`}</button>
          {/each}
        </div>
      {/if}
      <div class="list" role="list">
        {#if loading && items.length === 0}
          <p class="empty">wczytywanie</p>
        {:else if failed && items.length === 0}
          <p class="error">[!] nie udalo sie wczytac przepisow</p>
        {:else if items.length === 0}
          <p class="empty">{searchQuery || selectedTags.length > 0 ? 'brak wynikow' : 'brak przepisow'}{searchQuery ? ` dla: ${searchQuery}` : ''}</p>
        {:else}
          {#each items as recipe (recipe.id)}
            <div class="row-wrap">
              <button type="button" class="row" onclick={() => void openDetail(recipe)}>
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
          {#if nextCursor}
            <div class="more" bind:this={sentinel}>
              {#if moreFailed || !canObserve}
                {#if moreFailed}<span class="error">[!] nie udalo sie wczytac dalszych</span>{/if}
                <button type="button" class="btn-ghost" disabled={loadingMore} onclick={() => { moreFailed = false; void loadMore() }}>
                  WIECEJ
                </button>
              {:else}
                <span class="empty">wczytywanie</span>
              {/if}
            </div>
          {/if}
        {/if}
      </div>

      {#if rejections.length > 0}
        <button
          type="button"
          class="btn-ghost rejections-toggle"
          onclick={() => { void loadRejections(); mode = 'rejections' }}
        >
          NIEUDANE PROBY ({rejections.length})
        </button>
      {/if}

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

  /* Same layout as .row (flex column, same padding/gap) but not a button —
     a rejection row's own actions are PONOW/delete beside it, not the row itself. */
  .rejection-info {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-1);
    flex: 1 1 auto;
    min-width: 0;
    min-height: var(--control-h-sm);
    padding: var(--space-2) var(--space-2);
  }

  /* The sentinel row: in view means "load the next page". */
  .more {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--control-h-sm);
    padding: var(--space-2);
  }

  /* Tag chips — K7Calendar's .tab pattern: one scrolling row, and the
     selected state is carried by literal [ ] brackets plus the strong border,
     never by colour alone. */
  .facets {
    display: flex;
    gap: var(--space-2);
    overflow-x: auto;
    padding-bottom: var(--space-1);
    flex: 0 0 auto;
  }

  .facet {
    flex: 0 0 auto;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-label);
    min-height: var(--control-h-sm);
    padding: var(--space-1) var(--space-2);
    background: transparent;
    color: var(--fg-muted);
    border: var(--border-w) solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    white-space: nowrap;
  }
  .facet:hover { background: var(--ghost-hover); color: var(--fg); }
  .facet:active { background: var(--ghost-active); }
  .facet:focus {
    outline: var(--focus-w) solid var(--focus);
    outline-offset: calc(var(--focus-offset) * -1);
  }
  @supports selector(:focus-visible) {
    .facet:focus:not(:focus-visible) { outline: none; }
  }
  .facet-on {
    color: var(--fg);
    border-color: var(--border-strong);
  }

  .rejections-toggle {
    flex: 0 0 auto;
    align-self: flex-start;
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

  /* Same field look as the import URL, pinned above the scrolling rows. */
  .search {
    /* iPadOS 15 draws type="search" natively — rounded, its own padding —
       and ignores border-radius until the native look is switched off. */
    -webkit-appearance: none;
    appearance: none;
    flex: 0 0 auto;
    position: sticky;
    top: 0;
    z-index: 1;
  }

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
    display: block;
    margin: 0;
    color: var(--fg-muted);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
    text-decoration: none;
  }
  /* Same pattern as K7Comic's .credit: the class is shared between the
     plain-text and clickable-link states, so only the anchor gets hover/focus. */
  a.review-source:hover { color: var(--fg); }
  a.review-source:focus {
    outline: var(--focus-w) solid var(--focus);
    outline-offset: var(--focus-offset);
  }
  @supports selector(:focus-visible) {
    a.review-source:focus:not(:focus-visible) { outline: none; }
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

  .detail-description {
    margin: 0;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
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
